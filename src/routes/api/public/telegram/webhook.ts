import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// POST /api/public/telegram/webhook — Telegram direct mode (optional alternative to n8n).
// Active only when TELEGRAM_BOT_TOKEN is set (Settings → Integrasi or env). Telegram must send
// the X-Telegram-Bot-Api-Secret-Token registered by "Pasang webhook"; anything else gets 401.
// Runs the same handleBotUpdate() as /api/public/n8n/bot and replies via the Bot API, then
// answers 200 so Telegram does not retry (bot drafts are idempotent per update_id anyway).
export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: withErrorLogging("telegram:webhook", async ({ request }) => {
        const { json } = await import("@/lib/api-key.server");
        if ((await import("@/lib/demo.server")).isDemo())
          return json({ ok: false, error: "demo" }, 403);
        const tg = await import("@/lib/telegram.server");
        const token = await tg.telegramToken();
        if (!token) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN belum diatur" }, 503);
        const expected = tg.webhookSecret(token);
        if (
          !expected ||
          !tg.secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), expected)
        )
          return json({ ok: false, error: "Unauthorized" }, 401);
        const { readJsonBody } = await import("@/lib/bot-request");
        const body = await readJsonBody(request, 1_000_000);
        if (!body.ok) return json({ ok: false, error: body.error }, body.status);
        await tg.handleTelegramUpdate(token, body.value);
        return json({ ok: true });
      }),
    },
  },
});
