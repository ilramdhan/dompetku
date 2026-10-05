import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOT_AI_DAILY_LIMIT,
  parseDailyLimit,
  quotaExceeded,
  usageFromResponse,
} from "@/lib/ai-usage";

describe("parseDailyLimit", () => {
  it("empty, unset or invalid → default 50", () => {
    expect(DEFAULT_BOT_AI_DAILY_LIMIT).toBe(50);
    for (const v of [undefined, null, "", "  ", "abc", "-3", "1.5"])
      expect(parseDailyLimit(v), String(v)).toBe(50);
  });
  it('"0" → unlimited, positive → that number', () => {
    expect(parseDailyLimit("0")).toBeNull();
    expect(parseDailyLimit(" 20 ")).toBe(20);
  });
});

describe("quotaExceeded", () => {
  it("blocks once used reaches the limit", () => {
    expect(quotaExceeded(0, 50)).toBe(false);
    expect(quotaExceeded(49, 50)).toBe(false);
    expect(quotaExceeded(50, 50)).toBe(true);
    expect(quotaExceeded(51, 50)).toBe(true);
  });
  it("null limit never blocks", () => {
    expect(quotaExceeded(10_000, null)).toBe(false);
  });
});

describe("usageFromResponse", () => {
  it("reads OpenAI-compatible usage", () => {
    expect(
      usageFromResponse({
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    ).toEqual({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
  });
  it("derives total and tolerates missing/garbage values", () => {
    expect(usageFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    const none = { prompt_tokens: null, completion_tokens: null, total_tokens: null };
    expect(usageFromResponse(null)).toEqual(none);
    expect(usageFromResponse({})).toEqual(none);
    expect(usageFromResponse({ usage: { prompt_tokens: "x", total_tokens: -1 } })).toEqual(none);
  });
});
