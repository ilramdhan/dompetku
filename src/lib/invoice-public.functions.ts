import { createServerFn } from "@tanstack/react-start";

/**
 * PUBLIC (no login, issue #93): the customer view of one invoice by its share token. This is the
 * first public surface that reads financial data, so it is deliberately tiny:
 * - input is only a string, truncated; anything but a well-formed token is rejected before any DB
 *   access (inside `publicInvoiceByToken`);
 * - the token is SHA-256 hashed and looked up by equality on the unique hash;
 * - every failure (unknown/revoked/expired token, draft/cancelled invoice, missing schema, DB
 *   error) returns the same `null`, which the route turns into the same 404;
 * - the result is the `toPublicInvoice()` whitelist (no wallet, notes, ids or payment references)
 *   plus the v24 payment block (`toPublicMethod()` whitelist: never `account_id` or method ids).
 */
export const getPublicInvoice = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => {
    const token = (d as { token?: unknown } | null)?.token;
    return { token: typeof token === "string" ? token.slice(0, 128) : "" };
  })
  .handler(async ({ data }) => {
    const { publicInvoiceByToken } = await import("./invoice-share.server");
    return publicInvoiceByToken(data.token);
  });

/** Fixed public messages the client may show as-is (everything else becomes PROOF_FAILED). */
const PUBLIC_ERRORS = new Set<string>();

/**
 * PUBLIC (v24, issue #94): the customer uploads a transfer proof for the invoice behind `token`.
 * Hand-rolled validation (no zod in the public bundle): every field is type-checked and bounded
 * before `submitProof()`, which enforces demo-off, persistent per-IP/per-token rate limits, the
 * hashed token lookup, magic-byte image sniffing (≤5 MB), max pending proofs and remaining amount.
 * The answer is only `{ ok: true }` — never a file URL, path or id. Errors are a fixed set of
 * messages; anything unexpected is logged and replaced by a generic one.
 */
export const submitInvoiceProof = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
    const ref = Number(o["method_ref"]);
    const amount = Number(o["claimed_amount"]);
    return {
      token: str(o["token"], 128) ?? "",
      method_ref: Number.isInteger(ref) && ref >= 0 && ref < 100 ? ref : null,
      claimed_amount: Number.isFinite(amount) ? amount : NaN,
      payer_name: str(o["payer_name"], 200),
      note: str(o["note"], 1000),
      // Over-long strings are cut and then fail the data-URL check (never decoded).
      image: str(o["image"], 7_100_000) ?? "",
    };
  })
  .handler(async ({ data }) => {
    const pm = await import("./invoice-payments.server");
    const { assertNotDemo } = await import("./demo.server");
    const { DEMO_DISABLED, clientIp } = await import("./demo");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!PUBLIC_ERRORS.size) {
      const ip = await import("./invoice-payments");
      for (const m of [
        pm.PROOF_NOT_FOUND,
        pm.PROOF_RATE_LIMITED,
        pm.PROOF_FAILED,
        DEMO_DISABLED,
        ip.UPLOAD_OFF.full,
        "Format gambar tidak didukung (JPEG/PNG/WebP).",
        "Gambar maksimal 5 MB",
        "Pilih foto bukti transfer",
        "Jumlah harus lebih dari 0",
        "Jumlah tidak valid",
        "Jumlah melebihi sisa tagihan",
      ])
        PUBLIC_ERRORS.add(m);
    }
    try {
      assertNotDemo();
      return await pm.submitProof(data, clientIp(getRequest().headers));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (PUBLIC_ERRORS.has(msg)) throw new Error(msg);
      try {
        (await import("./monitoring.server")).logError("public:proof", e);
      } catch {
        /* ignore */
      }
      throw new Error(pm.PROOF_FAILED);
    }
  });

/**
 * PUBLIC (v25, issue #97): "Bayar sekarang" — creates (or reuses) a Midtrans Snap order for the
 * invoice behind `token`. Only a string token goes in; demo-off, rate limited per IP and per
 * token (persistent, fails closed), hashed token lookup, amount = remaining computed server-side.
 * Answers only the Snap token, redirect URL, public client key and the fixed snap.js URL.
 */
export const createGatewayPayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const token = (d as { token?: unknown } | null)?.token;
    return { token: typeof token === "string" ? token.slice(0, 128) : "" };
  })
  .handler(async ({ data }) => {
    const gw = await import("./gateway/payments.server");
    const { isDemo } = await import("./demo.server");
    const { DEMO_DISABLED, clientIp } = await import("./demo");
    const { getRequest } = await import("@tanstack/react-start/server");
    const allowed = new Set([gw.PAY_UNAVAILABLE, gw.PAY_RATE_LIMITED, gw.PAY_FAILED]);
    if (isDemo()) throw new Error(DEMO_DISABLED);
    try {
      const req = getRequest();
      const { seoConfig } = await import("./seo.server");
      // Finish URL only from the configured PUBLIC_SITE_URL (never the request Host header);
      // without it Midtrans uses the Finish Redirect URL from its dashboard.
      return await gw.startGatewayPayment(data.token, clientIp(req.headers), seoConfig().siteUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (allowed.has(msg)) throw new Error(msg);
      try {
        (await import("./monitoring.server")).logError("public:gateway", e);
      } catch {
        /* ignore */
      }
      throw new Error(gw.PAY_FAILED);
    }
  });
