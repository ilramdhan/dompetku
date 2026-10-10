import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANDING,
  DEFAULT_ICON,
  MAX_LOGO_BYTES,
  brandingOf,
  isHttpsUrl,
  isLogoDataUrl,
  isValidTimezone,
  parseLogoDataUrl,
  reminderDays,
  resolveSettings,
} from "@/lib/app-settings";
import { appSettingsInputSchema } from "@/lib/app-settings-schema";
import { classifyBotCommand } from "@/lib/bot";

const png = (bytes: number) => `data:image/png;base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

describe("resolveSettings", () => {
  it("falls back to env then built-in defaults when the table is missing", () => {
    const s = resolveSettings(null, {});
    expect(s.app_name).toBe("Dompetku");
    expect(s.timezone).toBe("Asia/Jakarta");
    expect(s.base_currency).toBe("IDR");
    expect(s.landing_enabled).toBe(true);
    expect(s.reminder_days).toBeNull();
    const e = resolveSettings(null, {
      APP_TIMEZONE: "Asia/Makassar",
      BOT_DEFAULT_ACCOUNT: " BCA ",
    });
    expect(e.timezone).toBe("Asia/Makassar");
    expect(e.bot_default_account_name).toBe("BCA");
  });
  it("lets the row override env and ignores invalid values", () => {
    const s = resolveSettings(
      {
        app_name: "  Kas Rumah ",
        timezone: "Europe/Berlin",
        base_currency: "USD",
        landing_enabled: false,
        reminder_days: 10,
        github_url: "https://github.com/example/fintrack",
      },
      { APP_TIMEZONE: "Asia/Makassar" },
    );
    expect(s).toMatchObject({
      app_name: "Kas Rumah",
      timezone: "Europe/Berlin",
      base_currency: "USD",
      landing_enabled: false,
      reminder_days: 10,
    });
    const bad = resolveSettings(
      {
        app_name: "",
        timezone: "Mars/Olympus",
        base_currency: "EUR",
        reminder_days: 0,
        github_url: "javascript:alert(1)",
        logo_data: "data:image/svg+xml;base64,PHN2Zz4=",
      },
      { APP_TIMEZONE: "Asia/Jayapura" },
    );
    expect(bad).toMatchObject({
      app_name: "Dompetku",
      timezone: "Asia/Jayapura",
      base_currency: "IDR",
      reminder_days: null,
      github_url: null,
      logo_data: null,
    });
  });
});

describe("logo & branding", () => {
  it("accepts small raster data URLs only", () => {
    expect(isLogoDataUrl(png(100))).toBe(true);
    expect(isLogoDataUrl(png(MAX_LOGO_BYTES))).toBe(true);
    expect(isLogoDataUrl(png(MAX_LOGO_BYTES + 1))).toBe(false);
    expect(isLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isLogoDataUrl("https://example.com/a.png")).toBe(false);
    expect(parseLogoDataUrl(png(3))).toEqual({ mime: "image/png", base64: "AQEB" });
  });
  it("exposes only public fields with a cache-busting icon URL", () => {
    expect(DEFAULT_BRANDING.logo_url).toBe(DEFAULT_ICON);
    const b = brandingOf(
      resolveSettings(
        { logo_data: png(10), updated_at: "2026-10-04T00:00:00Z", bot_default_account_id: "x" },
        { BOT_DEFAULT_ACCOUNT: "BCA" },
      ),
    );
    expect(b.has_logo).toBe(true);
    expect(b.logo_url).toMatch(/^\/api\/public\/app-icon\?v=/);
    expect(Object.keys(b).sort()).toEqual([
      "app_name",
      "demo_url",
      "github_url",
      "has_logo",
      "landing_enabled",
      "landing_tagline",
      "logo_url",
      "tagline",
    ]);
  });
});

describe("validation helpers", () => {
  it("checks time zones and https URLs", () => {
    expect(isValidTimezone("Asia/Jakarta")).toBe(true);
    expect(isValidTimezone("Nope/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isHttpsUrl("https://github.com/x")).toBe(true);
    expect(isHttpsUrl("http://github.com/x")).toBe(false);
  });
  it("parses the settings form input", () => {
    const ok = appSettingsInputSchema.parse({
      app_name: " ",
      tagline: "Kas keluarga",
      logo_data: null,
      timezone: "Asia/Tokyo",
      base_currency: "IDR",
      landing_enabled: true,
      landing_tagline: "",
      github_url: "",
      bot_default_account_id: "",
      reminder_days: "",
    });
    expect(ok).toMatchObject({
      app_name: null,
      tagline: "Kas keluarga",
      landing_tagline: null,
      github_url: null,
      bot_default_account_id: null,
      reminder_days: null,
    });
    const base = { ...ok, base_currency: "IDR" as const };
    expect(appSettingsInputSchema.safeParse({ ...base, timezone: "X/Y" }).success).toBe(false);
    expect(appSettingsInputSchema.safeParse({ ...base, reminder_days: 400 }).success).toBe(false);
    expect(appSettingsInputSchema.safeParse({ ...base, github_url: "ftp://x" }).success).toBe(
      false,
    );
    expect(appSettingsInputSchema.safeParse({ ...base, logo_data: png(10) }).success).toBe(true);
  });
  it("picks reminder days: request, then setting, then default", () => {
    expect(reminderDays(3, 10, 7)).toBe(3);
    expect(reminderDays(null, 10, 7)).toBe(10);
    expect(reminderDays(undefined, null, 7)).toBe(7);
    expect(reminderDays(999, null, 7)).toBe(365);
  });
  it("bot reminder commands without a number defer to the setting", () => {
    expect(classifyBotCommand("/tagihan")).toEqual({ type: "reminders", days: null });
    expect(classifyBotCommand("pengingat")).toEqual({ type: "reminders", days: null });
    expect(classifyBotCommand("/tagihan 30")).toEqual({ type: "reminders", days: 30 });
  });
});
