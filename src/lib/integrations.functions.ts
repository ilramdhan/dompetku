import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { INTEGRATION_KEYS, type IntegrationKey } from "./integrations";

const keySchema = z.enum(INTEGRATION_KEYS as [IntegrationKey, ...IntegrationKey[]]);

/** Status of every managed integration key. Secrets come back only as a masked hint. */
export const getIntegrationSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => {
    const { readIntegrations } = await import("./integrations.server");
    return readIntegrations();
  });

export const saveIntegrationFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: keySchema, value: z.string().max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { saveIntegration } = await import("./integrations.server");
    return saveIntegration(data.key, data.value);
  });

/** Deletes the DB value so the key falls back to its env var (or default). */
export const removeIntegrationFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ key: keySchema }).parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { removeIntegration } = await import("./integrations.server");
    return removeIntegration(data.key);
  });

/** "Tes koneksi" for the AI endpoint: a free GET …/models (no tokens used). */
export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ ok: boolean; message: string }> => {
    (await import("./demo.server")).assertNotDemo();
    const { aiConfig } = await import("./ocr.server");
    const { aiModelsUrl } = await import("./integrations");
    const { aiErrorReason } = await import("./ocr.server");
    const c = await aiConfig(true);
    if (!c.key) return { ok: false, message: "AI_API_KEY belum diatur" };
    const url = aiModelsUrl(c.url);
    if (!url) return { ok: false, message: "URL harus diakhiri /chat/completions" };
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${c.key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { ok: true, message: `OK · ${c.model}` };
      const reason = aiErrorReason(await res.text());
      return { ok: false, message: `HTTP ${res.status}${reason ? `: ${reason}` : ""}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.name : "Gagal" };
    }
  });

/** Telegram direct-mode status: bot username and current webhook (no token). */
export const telegramStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => {
    const tg = await import("./telegram.server");
    const token = await tg.telegramToken();
    if (!token) return { configured: false as const };
    const me = await tg.tgApi(token, "getMe");
    const info = await tg.webhookInfo(token);
    return {
      configured: true as const,
      ok: me.ok,
      username: me.ok ? ((me.result as { username?: string }).username ?? null) : null,
      error: me.ok ? null : (me.description ?? null),
      webhook: info,
    };
  });

export const setTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url().max(300) }).parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const tg = await import("./telegram.server");
    const token = await tg.telegramToken();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diatur");
    const url = await tg.setWebhook(token, data.origin);
    await (await import("./finance.server")).logActivity("integration.webhook_set", "telegram");
    return { url };
  });

export const deleteTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async () => {
    (await import("./demo.server")).assertNotDemo();
    const tg = await import("./telegram.server");
    const token = await tg.telegramToken();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diatur");
    await tg.deleteWebhook(token);
    await (await import("./finance.server")).logActivity("integration.webhook_delete", "telegram");
    return { ok: true };
  });
