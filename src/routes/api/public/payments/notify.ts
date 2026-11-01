import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// POST /api/public/payments/notify — bank / e-wallet notification forwarded by MacroDroid (v26,
// issue #96). Guide: docs/MACRODROID.md. Order of checks: demo → 403; no MACRODROID_TOKEN → 503;
// device token (Authorization: Bearer / X-Device-Token) compared as SHA-256 digests in constant
// time → 401 (only wrong tokens are rate limited per IP → 429, so a spoofed X-Forwarded-For can
// never block the real phone); v26 missing → 503; per-device limit → 429; body ≤ 16 KB (413) and
// JSON (400); then the notification is parsed with the admin-defined formats, deduplicated by hash,
// matched against open invoices (remaining + unique code) and stored with minimised text.
// Body: { app, package, title, text, big_text?, sub_text?, posted_at?, device? } (MacroDroid magic
// text {not_app_name} {not_app_package} {not_title} {notification} {not_text_big} {not_sub_text}
// {not_timestamp}). Answers 200 { ok, status } for stored/duplicate/ignored notifications.
export const Route = createFileRoute("/api/public/payments/notify")({
  server: {
    handlers: {
      POST: withErrorLogging("payments:notify", async ({ request }) => {
        const { json } = await import("@/lib/api-key.server");
        if ((await import("@/lib/demo.server")).isDemo())
          return json({ ok: false, error: "demo" }, 403);
        const { clientIp } = await import("@/lib/demo");
        const { readJsonBody } = await import("@/lib/bot-request");
        const s = await import("@/lib/payment-signals.server");
        const r = await s.handleNotify(
          request.headers,
          () => readJsonBody(request, s.NOTIFY_MAX_BODY),
          clientIp(request.headers),
        );
        return json(r.body, r.status);
      }),
    },
  },
});
