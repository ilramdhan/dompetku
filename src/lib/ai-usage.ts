/**
 * Pure, client-safe helpers for the AI usage log (schema v15 `ai_usage`) and the bot's
 * daily AI quota per chat (`BOT_AI_DAILY_LIMIT`). Unit-tested in src/test/ai-usage.test.ts.
 */

/** Default bot AI calls (chat parsing + photo OCR) per chat per app-local day. */
export const DEFAULT_BOT_AI_DAILY_LIMIT = 50;

/**
 * `BOT_AI_DAILY_LIMIT`: empty/unset/invalid → 50, "0" → unlimited (null), N > 0 → N.
 */
export function parseDailyLimit(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_BOT_AI_DAILY_LIMIT;
  if (!/^\d+$/.test(s)) return DEFAULT_BOT_AI_DAILY_LIMIT;
  const n = Number(s);
  return n === 0 ? null : n;
}

/** True when another AI call would go over the limit (null limit = unlimited). */
export function quotaExceeded(used: number, limit: number | null): boolean {
  if (limit == null) return false;
  return used >= limit;
}

export type AiTokens = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
};

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/** Reads OpenAI-compatible `usage` from a chat completion response; nulls when absent. */
export function usageFromResponse(body: unknown): AiTokens {
  const u = (body as { usage?: Record<string, unknown> } | null | undefined)?.usage;
  const prompt = int(u?.["prompt_tokens"]);
  const completion = int(u?.["completion_tokens"]);
  const total =
    int(u?.["total_tokens"]) ?? (prompt != null && completion != null ? prompt + completion : null);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}
