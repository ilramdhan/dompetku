import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";
import { z } from "zod";

// GET  /api/public/n8n/invoices-due-email?lead=3 → ready-to-send customer reminder mails
//      { ok, count, mails: [{ to, subject, text, html, kind, number, … }] }; the mails are
//      marked as handed over (activity_log `invoices.email`) so the next call skips them.
// POST /api/public/n8n/invoices-due-email { lead? } → sends them directly via Resend.
// Due soon: once per invoice; overdue: at most weekly. No schema.
const body = z.object({ lead: z.coerce.number().int().min(0).max(30).optional() });

export const Route = createFileRoute("/api/public/n8n/invoices-due-email")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:invoices-due-email", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        try {
          const lead = new URL(request.url).searchParams.get("lead");
          const { runDueMails } = await import("@/lib/invoice-email.server");
          const r = await runDueMails("payload", lead === null ? undefined : Number(lead));
          return json({ ok: true, ...r });
        } catch (e) {
          await reportServerError("n8n:invoices-due-email", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
      POST: withErrorLogging("n8n:invoices-due-email", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const parsed = body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return json({ ok: false, error: "Input tidak valid", issues: parsed.error.issues }, 400);
        try {
          const { runDueMails } = await import("@/lib/invoice-email.server");
          const r = await runDueMails("resend", parsed.data.lead);
          return json({ ok: !r.reason && r.failed === 0, ...r }, r.reason ? 503 : 200);
        } catch (e) {
          await reportServerError("n8n:invoices-due-email", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
