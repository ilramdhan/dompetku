import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/notifications?kind=report&period=today|lastweek|lastmonth|…
// GET /api/public/n8n/notifications?kind=reminders&days=3[&skip_empty=0]
// → { ok, kind, count, messages: [{ chat_id, text, recipient, wallets, count? }] }
// Owner = TELEGRAM_ADMIN_CHAT_ID (Settings → Integrasi > env) with the global text of /report or
// /reminders; v22 members get a message scoped to their wallets. n8n loops over `messages`.
export const Route = createFileRoute("/api/public/n8n/notifications")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:notifications", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const url = new URL(request.url);
        const { isNotifyKind } = await import("@/lib/notify");
        const kind = url.searchParams.get("kind");
        if (!isNotifyKind(kind))
          return json({ ok: false, error: "kind harus report atau reminders" }, 400);
        try {
          const { getAppSettings } = await import("@/lib/app-settings.server");
          const { reminderDays } = await import("@/lib/app-settings");
          const days = reminderDays(
            Number(url.searchParams.get("days")) || null,
            (await getAppSettings()).reminder_days,
            7,
          );
          const { buildNotifications } = await import("@/lib/notify.server");
          const res = await buildNotifications({
            kind,
            period: (url.searchParams.get("period") ?? "month").slice(0, 20),
            days,
            // Reminders: recipients with nothing due are skipped unless ?skip_empty=0.
            skipEmpty: url.searchParams.get("skip_empty") !== "0",
          });
          if (!res.ok) return json(res, 400);
          return json({ ok: true, kind, count: res.messages.length, messages: res.messages });
        } catch (e) {
          await reportServerError("n8n:notifications", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
