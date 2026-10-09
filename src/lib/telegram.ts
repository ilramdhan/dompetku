/**
 * Pure, client-safe helpers for Telegram direct mode (`POST /api/public/telegram/webhook`):
 * turn a raw Telegram update into the same `{update_id, chat_id, text?, callback_data?}` body
 * n8n sends to `/api/public/n8n/bot`, and turn the bot's `{method,text,reply_markup,toast}` reply
 * into Bot API calls — mirroring the n8n template (n8n/01-dompetku-telegram-bot.json) so both
 * paths behave the same. Unit-tested in src/test/telegram.test.ts.
 */
import type { InlineKeyboard } from "./bot";

/** Same cap as the n8n template: base64 of ~3.2 MB stays under Vercel's 4.5 MB body limit. */
export const TG_MAX_IMAGE_BYTES = 3_200_000;
export const TG_MAX_TEXT = 4000;
export const WEBHOOK_PATH = "/api/public/telegram/webhook";

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Telegram JSON */
export type TgContext = {
  update_id: number;
  chat_id: string;
  message_id: number | null;
  callback_id: string | null;
};

export type TgIncoming =
  | { type: "ignore" }
  | (TgContext & { type: "callback"; callback_data: string })
  | (TgContext & { type: "text"; text: string })
  | (TgContext & {
      type: "image";
      file_id: string;
      file_size: number | null;
      mime_type: string;
      caption: string | null;
    })
  | (TgContext & { type: "reply"; text: string });

const IMAGE_DOC = /^image\/(jpeg|png|webp)$/;

/** Classifies a Telegram update (message / callback_query). Anything else is ignored. */
export function parseTelegramUpdate(u: any): TgIncoming {
  if (!u || typeof u !== "object" || !Number.isInteger(u.update_id)) return { type: "ignore" };
  const cb = u.callback_query;
  const msg = cb ? cb.message : u.message;
  const chatId = String(msg?.chat?.id ?? cb?.from?.id ?? "");
  if (!/^-?\d{1,20}$/.test(chatId)) return { type: "ignore" };
  const base: TgContext = {
    update_id: u.update_id,
    chat_id: chatId,
    message_id: typeof msg?.message_id === "number" ? msg.message_id : null,
    callback_id: cb?.id ? String(cb.id) : null,
  };
  if (cb) return { ...base, type: "callback", callback_data: String(cb.data ?? "").slice(0, 64) };
  if (!msg) return { type: "ignore" };
  const caption = typeof msg.caption === "string" ? msg.caption.slice(0, 2000) : null;
  if (Array.isArray(msg.photo) && msg.photo.length) {
    // Telegram lists sizes ascending; take the largest one under the cap, else the smallest.
    const sizes = [...msg.photo].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
    const fit = sizes.filter((p) => (p.file_size ?? 0) <= TG_MAX_IMAGE_BYTES).pop() ?? sizes[0];
    return {
      ...base,
      type: "image",
      file_id: String(fit.file_id),
      file_size: fit.file_size ?? null,
      mime_type: "image/jpeg",
      caption,
    };
  }
  if (msg.document && IMAGE_DOC.test(msg.document.mime_type ?? ""))
    return {
      ...base,
      type: "image",
      file_id: String(msg.document.file_id),
      file_size: msg.document.file_size ?? null,
      mime_type: msg.document.mime_type,
      caption,
    };
  if (typeof msg.text === "string" && msg.text)
    return { ...base, type: "text", text: msg.text.slice(0, 2000) };
  return {
    ...base,
    type: "reply",
    text: "🙏 Bot ini menerima teks dan foto struk. Ketik /help untuk bantuan.",
  };
}

export type BotReplyLike = {
  method: "send" | "edit" | "none";
  text?: string | null;
  reply_markup?: InlineKeyboard | null;
  toast?: string | null;
};
export type TgCall = { method: string; body: Record<string, unknown> };

/** Bot API calls for one bot reply — same mapping as the n8n template's "Reply method" switch. */
export function replyCalls(ctx: TgContext, r: BotReplyLike): TgCall[] {
  const calls: TgCall[] = [];
  if (ctx.callback_id)
    calls.push({
      method: "answerCallbackQuery",
      body: { callback_query_id: ctx.callback_id, text: r.toast ?? "" },
    });
  const markup = r.reply_markup ? { reply_markup: r.reply_markup } : {};
  if (r.method === "edit" && ctx.message_id != null)
    calls.push({
      method: "editMessageText",
      body: {
        chat_id: ctx.chat_id,
        message_id: ctx.message_id,
        text: String(r.text || "✔️").slice(0, TG_MAX_TEXT),
        ...markup,
      },
    });
  else if (r.method === "send" || r.method === "edit")
    calls.push({
      method: "sendMessage",
      body: {
        chat_id: ctx.chat_id,
        text: String(r.text || "⚠️ Server Dompetku sedang bermasalah, coba lagi sebentar.").slice(
          0,
          TG_MAX_TEXT,
        ),
        disable_web_page_preview: true,
        ...markup,
      },
    });
  return calls;
}

/** Telegram's secret_token alphabet: 1–256 of A–Z a–z 0–9 _ -. */
export function isValidWebhookSecret(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(s);
}

/** `<origin>/api/public/telegram/webhook`, https only (Telegram refuses plain http). */
export function webhookUrl(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return null;
    return `${u.origin}${WEBHOOK_PATH}`;
  } catch {
    return null;
  }
}
