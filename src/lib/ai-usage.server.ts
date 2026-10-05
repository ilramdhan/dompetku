/**
 * Server-only AI usage log (schema v15 `ai_usage`) and the bot's daily AI quota per chat.
 * Recording never throws; a missing table falls back to counting today's AI bot drafts.
 */
import { db } from "./db.server";
import { logError } from "./monitoring.server";
import { parseDailyLimit, quotaExceeded, type AiTokens } from "./ai-usage";

const fin = () => import("./finance.server");

export type AiMeta = { source: "bot" | "web"; chatId?: string | null | undefined };

export type AiUsageRecord = AiTokens & {
  meta: AiMeta;
  kind: "text" | "vision";
  model: string;
  ok: boolean;
};

/** Logs one AI call. Never throws: a missing v15 table is ignored, other errors are logged. */
export async function recordAiUsage(r: AiUsageRecord): Promise<void> {
  try {
    const f = await fin();
    const res = await db()
      .from("ai_usage")
      .insert({
        day: f.today(),
        source: r.meta.source,
        chat_id: r.meta.chatId ?? null,
        kind: r.kind,
        model: r.model.slice(0, 120),
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        total_tokens: r.total_tokens,
        ok: r.ok,
      });
    if (res.error && !f.isMissingTable(res.error)) throw new Error(res.error.message);
  } catch (e) {
    logError("ai_usage:record", e);
  }
}

/**
 * Bot AI calls for this chat today. Without the v15 table, counts the chat's AI/OCR drafts from
 * the last 24 h (approximation: only successful reads become drafts). Any other error fails open.
 */
export async function botAiCallsToday(chatId: string): Promise<number> {
  try {
    const f = await fin();
    const res = await db()
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("source", "bot")
      .eq("chat_id", chatId)
      .eq("day", f.today());
    if (!res.error) return res.count ?? (res.data as unknown[] | null)?.length ?? 0;
    if (!f.isMissingTable(res.error)) throw new Error(res.error.message);
    const drafts = await db()
      .from("bot_drafts")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .in("payload->>via", ["ai", "ocr"])
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if (drafts.error) return 0;
    return drafts.count ?? (drafts.data as unknown[] | null)?.length ?? 0;
  } catch (e) {
    logError("ai_usage:count", e);
    return 0;
  }
}

/** True when this chat has used up `BOT_AI_DAILY_LIMIT` (default 50, "0" = unlimited). */
export async function botAiQuotaReached(chatId: string): Promise<boolean> {
  const limit = parseDailyLimit(process.env["BOT_AI_DAILY_LIMIT"]);
  if (limit == null) return false;
  return quotaExceeded(await botAiCallsToday(chatId), limit);
}
