/**
 * Server-only Telegram direct mode: the app receives Telegram updates itself (webhook) instead of
 * via n8n, runs the exact same `handleBotUpdate()` as `/api/public/n8n/bot`, and sends the reply
 * through the Bot API. Optional — only active when TELEGRAM_BOT_TOKEN is set (Settings or env).
 * The webhook secret is derived (HMAC of the token with the settings key), so nothing extra is
 * stored and it rotates whenever the token changes.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { settingsKey } from "./secret-box.server";
import { logError } from "./monitoring.server";
import {
  parseTelegramUpdate,
  replyCalls,
  TG_MAX_IMAGE_BYTES,
  webhookUrl,
  type TgCall,
  type TgContext,
} from "./telegram";

const TIMEOUT_MS = 10_000;

export async function telegramToken(): Promise<string | undefined> {
  const { getIntegration } = await import("./integrations.server");
  return getIntegration("TELEGRAM_BOT_TOKEN");
}

/** Secret sent by Telegram in `X-Telegram-Bot-Api-Secret-Token`; null without a settings key. */
export function webhookSecret(token: string): string | null {
  const key = settingsKey();
  if (!key) return null;
  return createHmac("sha256", key).update(`telegram-webhook:${token}`).digest("base64url");
}

export function secretMatches(given: string | null, expected: string): boolean {
  const a = createHash("sha256")
    .update(given ?? "")
    .digest();
  const b = createHash("sha256").update(expected).digest();
  return given != null && timingSafeEqual(a, b);
}

/** Calls the Bot API. Never throws; returns Telegram's `{ok, result?, description?}`. */
export async function tgApi(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
    } | null;
    return { ok: !!j?.ok, result: j?.result, description: j?.description ?? `HTTP ${res.status}` };
  } catch (e) {
    // The URL holds the token: log only the method.
    logError(`telegram:${method}`, new Error(e instanceof Error ? e.name : "fetch failed"));
    return { ok: false, description: "network" };
  }
}

async function downloadImage(token: string, fileId: string): Promise<Buffer | null> {
  const f = await tgApi(token, "getFile", { file_id: fileId });
  const path = (f.result as { file_path?: string } | undefined)?.file_path;
  if (!f.ok || !path) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > TG_MAX_IMAGE_BYTES ? null : buf;
  } catch {
    return null;
  }
}

async function send(token: string, calls: TgCall[]) {
  for (const c of calls) {
    const r = await tgApi(token, c.method, c.body);
    if (!r.ok && c.method !== "answerCallbackQuery")
      logError("telegram:reply", new Error(`${c.method}: ${r.description ?? "failed"}`));
  }
}

/** Handles one verified webhook update end-to-end. Never throws. */
export async function handleTelegramUpdate(token: string, raw: unknown): Promise<void> {
  const inc = parseTelegramUpdate(raw);
  if (inc.type === "ignore") return;
  const ctx: TgContext = {
    update_id: inc.update_id,
    chat_id: inc.chat_id,
    message_id: inc.message_id,
    callback_id: inc.callback_id,
  };
  if (inc.type === "reply") return send(token, replyCalls(ctx, { method: "send", text: inc.text }));
  const bot = await import("./bot.server");
  try {
    // Allow-list first: unknown chats never trigger an image download or any finance DB access.
    if (!(await bot.chatAllowed(inc.chat_id))) {
      const r = await bot.handleBotUpdate({
        update_id: inc.update_id,
        chat_id: inc.chat_id,
        text: "/start",
      });
      return send(token, replyCalls(ctx, r));
    }
    let r;
    if (inc.type === "callback")
      r = await bot.handleBotUpdate({
        update_id: inc.update_id,
        chat_id: inc.chat_id,
        callback_data: inc.callback_data,
      });
    else if (inc.type === "text") {
      void tgApi(token, "sendChatAction", { chat_id: inc.chat_id, action: "typing" });
      r = await bot.handleBotUpdate({
        update_id: inc.update_id,
        chat_id: inc.chat_id,
        text: inc.text,
      });
    } else {
      void tgApi(token, "sendChatAction", { chat_id: inc.chat_id, action: "upload_photo" });
      const buf =
        inc.file_size != null && inc.file_size > TG_MAX_IMAGE_BYTES
          ? null
          : await downloadImage(token, inc.file_id);
      if (!buf)
        return send(
          token,
          replyCalls(ctx, {
            method: "send",
            text: "⚠️ Foto gagal diunduh atau terlalu besar (maks ±3 MB). Kirim sebagai foto biasa.",
          }),
        );
      r = await bot.handleBotUpdate({
        update_id: inc.update_id,
        chat_id: inc.chat_id,
        text: inc.caption,
        image_base64: buf.toString("base64"),
        mime_type: inc.mime_type,
      });
    }
    await send(token, replyCalls(ctx, r));
  } catch (e) {
    logError("telegram:webhook", e);
    const msg = e instanceof Error ? e.message : "Gagal";
    await send(
      token,
      replyCalls(ctx, { method: inc.type === "callback" ? "edit" : "send", text: `⚠️ ${msg}` }),
    );
  }
}

export type WebhookInfo = { url: string; pending: number; lastError: string | null } | null;

export async function webhookInfo(token: string): Promise<WebhookInfo> {
  const r = await tgApi(token, "getWebhookInfo");
  if (!r.ok) return null;
  const i = r.result as {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
  };
  return {
    url: i.url ?? "",
    pending: i.pending_update_count ?? 0,
    lastError: i.last_error_message ?? null,
  };
}

export async function setWebhook(token: string, origin: string) {
  const url = webhookUrl(origin);
  if (!url) throw new Error("Webhook butuh alamat https.");
  const secret = webhookSecret(token);
  if (!secret) throw new Error("SESSION_SECRET (≥ 32 karakter) dibutuhkan untuk webhook.");
  const r = await tgApi(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (!r.ok) throw new Error(`Telegram: ${r.description ?? "gagal"}`);
  return url;
}

export async function deleteWebhook(token: string) {
  const r = await tgApi(token, "deleteWebhook", { drop_pending_updates: false });
  if (!r.ok) throw new Error(`Telegram: ${r.description ?? "gagal"}`);
}
