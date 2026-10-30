import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// POST /api/public/payments/midtrans — Midtrans HTTP(S) notification (v25, issue #97).
// Set it as "Payment Notification URL" in the Midtrans dashboard. Order of checks:
// demo → 403; gateway off → 503 (no details); body ≤ 64 KB; per-IP rate limit; signature
// SHA512(order_id + status_code + gross_amount + server key) compared in constant time → 401;
// then the status and amount are ALWAYS re-read from the Midtrans Get Status API (the body is
// never trusted), the transition machine is applied and a success books the payment once.
// Midtrans retries on non-2xx, so processed/ignored events answer 200 and transient errors 503.
const MAX_BODY = 64_000;
const RULES = [{ name: "midtrans:ip", limit: 600, windowMs: 3_600_000 }] as const;

export const Route = createFileRoute("/api/public/payments/midtrans")({
  server: {
    handlers: {
      POST: withErrorLogging("gateway:midtrans", async ({ request }) => {
        const { json } = await import("@/lib/api-key.server");
        if ((await import("@/lib/demo.server")).isDemo())
          return json({ ok: false, error: "demo" }, 403);
        const { midtransConfig } = await import("@/lib/gateway/midtrans.server");
        if (!(await midtransConfig())) return json({ ok: false }, 503);
        const { readJsonBody } = await import("@/lib/bot-request");
        const body = await readJsonBody(request, MAX_BODY);
        if (!body.ok) return json({ ok: false }, body.status);
        const { clientIp } = await import("@/lib/demo");
        const { rateHit, subjectHash } = await import("@/lib/rate-limit.server");
        // Fails closed without v24/SESSION_SECRET; 503 makes Midtrans retry later.
        if (!(await rateHit(RULES, subjectHash(`ip:${clientIp(request.headers)}`))))
          return json({ ok: false }, 503);
        const gw = await import("@/lib/gateway/payments.server");
        const r = await gw.handleMidtransWebhook(body.value);
        return json(r.body, r.status);
      }),
    },
  },
});
