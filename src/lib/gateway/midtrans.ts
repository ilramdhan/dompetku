/**
 * Pure Midtrans helpers (v25, issue #97): environments, signature input, notification parsing,
 * status mapping, Snap request body and status-response parsing. No I/O and no Node APIs (the
 * SHA-512 itself is in ./midtrans.server.ts). Unit-tested in src/test/gateway.test.ts.
 *
 * References (docs.midtrans.com, checked 2026-10):
 * - Snap: POST {app}/snap/v1/transactions, Basic auth base64("<server key>:"), 201 {token, redirect_url};
 *   snap.js at {app}/snap/snap.js with data-client-key. Token/redirect_url live 24 h by default.
 * - Notification: JSON POST; signature_key = SHA512(order_id + status_code + gross_amount + server key),
 *   gross_amount is a string with two decimals ("10000.00"); answer 2xx (retries otherwise).
 * - Core API: GET {api}/v2/{order_id}/status, POST {api}/v2/{order_id}/refund.
 * - Success = settlement, or capture with fraud_status accept (missing fraud_status = ignore it).
 */
import type { CreatePaymentInput, GatewayState, GatewayStatus, RefundEntry } from "./types";

export const MIDTRANS_HOSTS = {
  sandbox: { api: "https://api.sandbox.midtrans.com", snap: "https://app.sandbox.midtrans.com" },
  production: { api: "https://api.midtrans.com", snap: "https://app.midtrans.com" },
} as const;

/** snap.js URL for the browser — fixed hosts only (never an override). */
export function snapJsUrl(production: boolean): string {
  return `${(production ? MIDTRANS_HOSTS.production : MIDTRANS_HOSTS.sandbox).snap}/snap/snap.js`;
}

/**
 * Normalises a test-only base URL override (MIDTRANS_API_BASE / MIDTRANS_SNAP_BASE). Ignored in
 * production mode and for anything but a plain http(s) origin(+path) without credentials.
 */
export function baseOverride(raw: string | null | undefined, production: boolean): string | null {
  if (production || !raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export const parseBool = (v: string | null | undefined, def: boolean) => {
  const s = (v ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return def;
};

/** Sandbox keys start with "SB-" (Midtrans dashboard → Access Keys). */
export const isSandboxKey = (key: string | null | undefined) => /^SB-/i.test(key ?? "");

/** True when the key's environment does not match the mode (sandbox key in production or v.v.). */
export function keyModeMismatch(serverKey: string | null | undefined, production: boolean) {
  if (!serverKey) return false;
  return isSandboxKey(serverKey) === production;
}

/** String hashed for `signature_key` (exactly as received, no re-formatting). */
export function signatureInput(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return `${orderId}${statusCode}${grossAmount}${serverKey}`;
}

export type MidtransNotification = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
};

/** Minimal shape check of a notification body (everything else is re-read from the API). */
export function parseNotification(body: unknown): MidtransNotification | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const s = (k: string, re: RegExp) => {
    const v = o[k];
    const str = typeof v === "number" ? String(v) : v;
    return typeof str === "string" && re.test(str) ? str : null;
  };
  const order_id = s("order_id", /^[A-Za-z0-9._~-]{1,50}$/);
  const status_code = s("status_code", /^\d{3}$/);
  const gross_amount = s("gross_amount", /^\d{1,15}(\.\d{1,2})?$/);
  const signature_key = s("signature_key", /^[0-9a-fA-F]{128}$/);
  if (!order_id || !status_code || !gross_amount || !signature_key) return null;
  return { order_id, status_code, gross_amount, signature_key: signature_key.toLowerCase() };
}

/** transaction_status + fraud_status → internal status (null = unknown, ignore). */
export function mapMidtransStatus(
  transactionStatus: string | null | undefined,
  fraudStatus: string | null | undefined,
): GatewayStatus | null {
  const ts = (transactionStatus ?? "").toLowerCase();
  const fs = (fraudStatus ?? "").toLowerCase();
  if (fs === "deny" && (ts === "capture" || ts === "settlement" || ts === "pending"))
    return "failed";
  switch (ts) {
    case "settlement":
      return "success";
    case "capture":
      // capture + challenge waits for a manual review in the Midtrans dashboard.
      return fs === "challenge" ? "pending" : "success";
    case "pending":
    case "authorize":
      return "pending";
    case "deny":
    case "cancel":
    case "failure":
      return "failed";
    case "expire":
      return "expired";
    case "refund":
    case "chargeback":
      return "refunded";
    case "partial_refund":
    case "partial_chargeback":
      return "partial_refund";
    default:
      return null;
  }
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const str = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v ? v.slice(0, max) : typeof v === "number" ? String(v) : null;

/**
 * Get Status response → provider-neutral state, or null when Midtrans does not know the order
 * (`status_code` 404) or the body is unusable.
 */
export function parseStatusResponse(body: unknown): GatewayState | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (String(o["status_code"] ?? "") === "404") return null;
  const orderId = str(o["order_id"], 50);
  const status = mapMidtransStatus(str(o["transaction_status"]), str(o["fraud_status"]));
  if (!orderId || !status) return null;
  const refunds: RefundEntry[] = Array.isArray(o["refunds"])
    ? (o["refunds"] as unknown[]).flatMap((r, i) => {
        if (!r || typeof r !== "object") return [];
        const x = r as Record<string, unknown>;
        const key = str(x["refund_key"], 80) ?? str(x["refund_chargeback_id"], 80) ?? `n${i + 1}`;
        const amount = num(x["refund_amount"]);
        return amount > 0 ? [{ key, amount, at: str(x["created_at"], 40) }] : [];
      })
    : [];
  const listed = refunds.reduce((s, r) => s + r.amount, 0);
  const total = num(o["refund_amount"]);
  return {
    orderId,
    gatewayTxId: str(o["transaction_id"], 100),
    status,
    providerStatus: (str(o["transaction_status"], 40) ?? "").toLowerCase(),
    grossAmount: num(o["gross_amount"]),
    paymentType: str(o["payment_type"], 60),
    refundedAmount: Math.max(total, listed),
    refunds,
    raw: {
      transaction_status: str(o["transaction_status"], 40),
      fraud_status: str(o["fraud_status"], 40),
      status_code: str(o["status_code"], 10),
      payment_type: str(o["payment_type"], 60),
      transaction_time: str(o["transaction_time"], 40),
      settlement_time: str(o["settlement_time"], 40),
      gross_amount: str(o["gross_amount"], 30),
      refund_amount: str(o["refund_amount"], 30),
      currency: str(o["currency"], 10),
    },
  };
}

const clip = (s: string | null | undefined, max: number) =>
  Array.from(s ?? "", (ch) => (ch.charCodeAt(0) < 32 || ch === "<" || ch === ">" ? " " : ch))
    .join("")
    .trim()
    .slice(0, max);

/** Snap /transactions request body (single line item = the remaining amount). */
export function snapRequestBody(i: CreatePaymentInput) {
  const name = clip(i.customerName, 50) || "Customer";
  const email = clip(i.customerEmail, 200);
  const phone = clip(i.customerPhone, 20).replace(/[^0-9+]/g, "");
  return {
    transaction_details: { order_id: i.orderId, gross_amount: i.amount },
    item_details: [
      {
        id: clip(i.invoiceNumber, 50) || "invoice",
        price: i.amount,
        quantity: 1,
        name: clip(`Invoice ${i.invoiceNumber}`, 50),
      },
    ],
    customer_details: {
      first_name: name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    },
    ...(i.finishUrl ? { callbacks: { finish: i.finishUrl } } : {}),
    expiry: { unit: "minutes", duration: Math.max(15, Math.min(7 * 24 * 60, i.expiryMinutes)) },
  };
}

/** Basic auth header value: base64("<server key>:"). */
export function basicAuth(serverKey: string): string {
  const raw = `${serverKey}:`;
  const b64 = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

/** Short, safe error text from a Midtrans error body (no echo of request data). */
export function midtransError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const msgs = Array.isArray(o["error_messages"]) ? (o["error_messages"] as unknown[]) : [];
    const m = str(msgs[0], 200) ?? str(o["status_message"], 200);
    if (m) return `Midtrans ${status}: ${m}`;
  }
  return `Midtrans HTTP ${status}`;
}
