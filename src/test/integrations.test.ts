import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_KEYS,
  INTEGRATION_KEYS,
  aiModelsUrl,
  formatCipher,
  isChatAllowed,
  isEmailSender,
  maskHint,
  parseCipher,
  resolveIntegration,
  validateIntegration,
} from "@/lib/integrations";
import { decryptSecret, encryptSecret, settingsKey } from "@/lib/secret-box.server";

const SECRET = "x".repeat(40);

describe("integration catalog", () => {
  it("never manages bootstrap/security values", () => {
    for (const k of FORBIDDEN_KEYS) expect(INTEGRATION_KEYS).not.toContain(k);
    expect(INTEGRATION_KEYS).not.toContain("BOT_DEFAULT_ACCOUNT"); // lives in app_settings (v14)
  });

  it("validates and normalises values per key", () => {
    expect(validateIntegration("BOT_ALLOWED_CHAT_IDS", " 111 , -222 ")).toEqual({
      ok: true,
      value: "111,-222",
    });
    expect(validateIntegration("BOT_ALLOWED_CHAT_IDS", "abc").ok).toBe(false);
    expect(validateIntegration("BOT_ALLOWED_CHAT_IDS", " , ").ok).toBe(false);
    expect(validateIntegration("BOT_TEXT_AI", "NEVER")).toEqual({ ok: true, value: "never" });
    expect(validateIntegration("BOT_TEXT_AI", "sometimes").ok).toBe(false);
    expect(validateIntegration("BOT_AI_DAILY_LIMIT", "0").ok).toBe(true);
    expect(validateIntegration("BOT_AI_DAILY_LIMIT", "-1").ok).toBe(false);
    expect(validateIntegration("AI_API_URL", "ftp://x").ok).toBe(false);
    expect(validateIntegration("AI_API_URL", "https://api.openai.com/v1/chat/completions").ok).toBe(
      true,
    );
    expect(validateIntegration("N8N_API_KEY", "short").ok).toBe(false);
    expect(validateIntegration("N8N_API_KEY", "a".repeat(24)).ok).toBe(true);
    expect(validateIntegration("AI_API_KEY", "has space").ok).toBe(false);
    expect(validateIntegration("EMAIL_TO", "a@b.co, c@d.io")).toEqual({
      ok: true,
      value: "a@b.co,c@d.io",
    });
    expect(validateIntegration("TELEGRAM_BOT_TOKEN", "123456789:" + "A".repeat(35)).ok).toBe(true);
    expect(validateIntegration("TELEGRAM_BOT_TOKEN", "nope").ok).toBe(false);
    expect(validateIntegration("AI_MODEL", "   ").ok).toBe(false);
  });

  it("accepts sender formats", () => {
    expect(isEmailSender("Dompetku <noreply@mail.example.com>")).toBe(true);
    expect(isEmailSender("noreply@mail.example.com")).toBe(true);
    expect(isEmailSender("Dompetku")).toBe(false);
  });

  it("resolves DB > env > default, ignoring invalid DB values", () => {
    expect(resolveIntegration("BOT_TEXT_AI", "never", "always")).toEqual({
      value: "never",
      source: "db",
    });
    expect(resolveIntegration("BOT_TEXT_AI", null, "always")).toEqual({
      value: "always",
      source: "env",
    });
    expect(resolveIntegration("BOT_TEXT_AI", "bogus", undefined)).toEqual({
      value: "auto",
      source: "default",
    });
    expect(resolveIntegration("AI_API_KEY", null, "")).toEqual({
      value: undefined,
      source: "none",
    });
  });

  it("masks secrets with a short hint only", () => {
    expect(maskHint("sk-1234567890abcd")).toBe("••••abcd");
    expect(maskHint("short")).toBe("••••");
    expect(maskHint(undefined)).toBeNull();
  });

  it("keeps the bot allow-list fail-closed", () => {
    expect(isChatAllowed(undefined, "111")).toBe(false);
    expect(isChatAllowed(" , ", "111")).toBe(false);
    expect(isChatAllowed("111,222", 222)).toBe(true);
    expect(isChatAllowed("111", "1111")).toBe(false);
  });

  it("derives the free models URL for the AI connection test", () => {
    expect(aiModelsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/models",
    );
    expect(aiModelsUrl("https://x.test/v1beta/openai/chat/completions?x=1")).toBe(
      "https://x.test/v1beta/openai/models",
    );
    expect(aiModelsUrl("https://x.test/v1/responses")).toBeNull();
    expect(aiModelsUrl("not a url")).toBeNull();
  });
});

describe("ciphertext format", () => {
  it("round-trips and rejects unknown versions/malformed values", () => {
    const s = formatCipher({ iv: "aaa", tag: "b-b", data: "c_c" });
    expect(s).toBe("v1:aaa:b-b:c_c");
    expect(parseCipher(s)).toEqual({ version: "v1", iv: "aaa", tag: "b-b", data: "c_c" });
    expect(parseCipher("v2:aaa:bbb:ccc")).toBeNull();
    expect(parseCipher("v1:aaa:bbb")).toBeNull();
    expect(parseCipher("v1:a+a:bbb:ccc")).toBeNull();
    expect(parseCipher("plain")).toBeNull();
  });
});

describe("secret box (AES-256-GCM)", () => {
  const key = settingsKey({ SESSION_SECRET: SECRET });

  it("encrypts with a random IV and decrypts back", () => {
    const a = encryptSecret("sk-secret-value", "AI_API_KEY", key);
    const b = encryptSecret("sk-secret-value", "AI_API_KEY", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret");
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSecret(a, "AI_API_KEY", key)).toBe("sk-secret-value");
  });

  it("returns null (never throws) on a rotated key, a moved value or tampering", () => {
    const c = encryptSecret("value", "AI_API_KEY", key);
    expect(decryptSecret(c, "AI_API_KEY", settingsKey({ SESSION_SECRET: "y".repeat(40) }))).toBe(
      null,
    );
    expect(decryptSecret(c, "RESEND_API_KEY", key)).toBeNull();
    const parts = c.split(":");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("AA") ? "BB" : "AA");
    expect(decryptSecret(parts.join(":"), "AI_API_KEY", key)).toBeNull();
    expect(decryptSecret("garbage", "AI_API_KEY", key)).toBeNull();
    expect(decryptSecret(c, "AI_API_KEY", null)).toBeNull();
  });

  it("prefers SETTINGS_ENCRYPTION_KEY and needs ≥ 32 chars", () => {
    expect(settingsKey({ SESSION_SECRET: "short" })).toBeNull();
    const own = settingsKey({ SETTINGS_ENCRYPTION_KEY: "k".repeat(32), SESSION_SECRET: SECRET });
    expect(own?.length).toBe(32);
    expect(own?.equals(key!)).toBe(false);
    // A too-short own key is ignored in favour of SESSION_SECRET.
    expect(
      settingsKey({ SETTINGS_ENCRYPTION_KEY: "short", SESSION_SECRET: SECRET })?.equals(key!),
    ).toBe(true);
    expect(() => encryptSecret("v", "AI_API_KEY", null)).toThrow();
  });
});
