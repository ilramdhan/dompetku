import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/reminders?days=7 — upcoming installments, subscriptions & budget alerts.
export const Route = createFileRoute("/api/public/n8n/reminders")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:reminders", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const url = new URL(request.url);
        try {
          const { getAppSettings } = await import("@/lib/app-settings.server");
          const { reminderDays } = await import("@/lib/app-settings");
          // ?days wins; otherwise the Settings reminder days (v14), else 7.
          const days = reminderDays(
            Number(url.searchParams.get("days")) || null,
            (await getAppSettings()).reminder_days,
            7,
          );
          const { computeReminders, remindersEmail, remindersText } =
            await import("@/lib/finance.server");
          const reminders = await computeReminders(days);
          const base = {
            ok: true,
            count: reminders.length,
            reminders,
            message: remindersText(reminders),
          };
          // ?format=email — siap diteruskan ke node email di n8n (subject + html + text)
          if (url.searchParams.get("format") === "email")
            return json({ ...base, email: remindersEmail(reminders) });
          return json(base);
        } catch (e) {
          await reportServerError("n8n:reminders", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
