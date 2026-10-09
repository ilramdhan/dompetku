import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/reminders-email?days=7 — reminders as ready-to-send email (subject/text/html).
export const Route = createFileRoute("/api/public/n8n/reminders-email")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:reminders-email", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        try {
          const { getAppSettings } = await import("@/lib/app-settings.server");
          const { reminderDays } = await import("@/lib/app-settings");
          const days = reminderDays(
            Number(new URL(request.url).searchParams.get("days")) || null,
            (await getAppSettings()).reminder_days,
            7,
          );
          const { reminderEmail } = await import("@/lib/finance.server");
          const mail = await reminderEmail(days);
          return json({ ok: true, ...mail, message: mail.text });
        } catch (e) {
          await reportServerError("n8n:reminders-email", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
