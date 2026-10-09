import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";
import { botUpdateSchema, readJsonBody } from "@/lib/bot-request";

// POST /api/public/n8n/bot — satu pintu untuk semua update Telegram dari n8n.
// Body: { update_id, chat_id, text?, image_base64?, mime_type?, callback_data? }
// mime_type wajib bila image_base64 ada: image/jpeg | image/png | image/webp (image/jpg → image/jpeg).
// Body > 4,5 MB (batas Vercel) ditolak 413.
// Balasan: { ok, method: "send"|"edit"|"none", text, reply_markup, toast? } → n8n tinggal meneruskan ke Telegram Bot API.
export const Route = createFileRoute("/api/public/n8n/bot")({
  server: {
    handlers: {
      POST: withErrorLogging("n8n:bot", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const body = await readJsonBody(request);
        if (!body.ok) return json({ ok: false, error: body.error, method: "none" }, body.status);
        const parsed = botUpdateSchema.safeParse(body.value);
        if (!parsed.success)
          return json({ ok: false, error: parsed.error.flatten(), method: "none" }, 400);
        try {
          const { handleBotUpdate } = await import("@/lib/bot.server");
          const r = await handleBotUpdate(parsed.data);
          return json({ ok: true, ...r });
        } catch (e) {
          await reportServerError("n8n:bot", e, request);
          const msg = e instanceof Error ? e.message : "Gagal";
          // Tetap 200 agar n8n bisa mengirim pesan error yang ramah ke pengguna.
          return json({
            ok: false,
            error: msg,
            method: parsed.data.callback_data ? "edit" : "send",
            text: `⚠️ ${msg}`,
            reply_markup: null,
          });
        }
      }),
    },
  },
});
