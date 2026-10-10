/**
 * Pure, client-safe helpers for the v14 `app_settings` row (single row, id = 1): defaults,
 * validation, merging over env vars and the public branding subset.
 *
 * Logo decision: the logo is stored inline as a small PNG/JPEG/WebP data URL (`logo_data`,
 * ≤ MAX_LOGO_BYTES) instead of Supabase Storage, so `<link rel="icon">` and the login page can
 * load it through the unauthenticated `/api/public/app-icon` route without signed URLs.
 * SVG is rejected because it can carry scripts when served from our origin.
 */
import { CURRENCIES } from "./currencies";

export const DEFAULT_APP_NAME = "Dompetku";
/** Default tagline is an i18n key (shown through `t()` while unchanged). */
export const DEFAULT_TAGLINE = "buku kas pribadi";
export const DEFAULT_TIMEZONE = "Asia/Jakarta";
export const DEFAULT_ICON = "/favicon.png";
export const MAX_LOGO_BYTES = 200 * 1024;
export const LOGO_SIZE = 512;

/** Common IANA zones offered in the settings select (any valid zone is accepted). */
export const TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "UTC",
] as const;

/**
 * base_currency is a stored preference only: reports, budgets and net worth always aggregate
 * `amount_idr`, so changing it does not convert or re-label existing totals.
 */
export type Currency = (typeof CURRENCIES)[number];

/** Raw columns of the app_settings row (all nullable = "use the default"). */
export type AppSettingsRow = {
  app_name: string | null;
  tagline: string | null;
  logo_data: string | null;
  timezone: string | null;
  base_currency: string | null;
  landing_enabled: boolean | null;
  landing_tagline: string | null;
  github_url: string | null;
  bot_default_account_id: string | null;
  reminder_days: number | null;
  updated_at?: string | null;
};

/** Environment fallbacks (read on the server only). */
export type AppEnv = {
  APP_TIMEZONE?: string | undefined;
  BOT_DEFAULT_ACCOUNT?: string | undefined;
  PUBLIC_DEMO_URL?: string | undefined;
};

/** Effective settings after merging the row over env vars and built-in defaults. */
export type ResolvedSettings = {
  app_name: string;
  tagline: string;
  logo_data: string | null;
  timezone: string;
  base_currency: Currency;
  landing_enabled: boolean;
  landing_tagline: string | null;
  github_url: string | null;
  /** Account id chosen in Settings (wins over BOT_DEFAULT_ACCOUNT). */
  bot_default_account_id: string | null;
  /** BOT_DEFAULT_ACCOUNT name, used when no id is set. */
  bot_default_account_name: string | null;
  /** Null = each consumer keeps its own default (bot 14 days, n8n 7 days). */
  reminder_days: number | null;
  updated_at: string | null;
  /** env PUBLIC_DEMO_URL when it is an https URL. */
  demo_url: string | null;
};

/** Non-sensitive fields exposed without login (landing, login page, document head). */
export type Branding = {
  app_name: string;
  tagline: string;
  logo_url: string;
  has_logo: boolean;
  landing_enabled: boolean;
  landing_tagline: string | null;
  github_url: string | null;
  /** Public demo instance link (env PUBLIC_DEMO_URL, https only); null hides "Coba demo". */
  demo_url: string | null;
};

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Decoded byte length of a base64 payload. */
function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** True for a PNG/JPEG/WebP base64 data URL no larger than MAX_LOGO_BYTES. */
export function isLogoDataUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = LOGO_RE.exec(s);
  return !!m && base64Bytes(m[2]!) <= MAX_LOGO_BYTES;
}

/** Splits a valid logo data URL into its MIME type and base64 payload (null when invalid). */
export function parseLogoDataUrl(s: string | null | undefined) {
  if (!isLogoDataUrl(s)) return null;
  const m = LOGO_RE.exec(s)!;
  return { mime: `image/${m[1]}`, base64: m[2]! };
}

export function isHttpsUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

const clean = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v ? v : null;
};

export function resolveSettings(
  row: Partial<AppSettingsRow> | null,
  env: AppEnv,
): ResolvedSettings {
  const r = row ?? {};
  const tz = [clean(r.timezone), clean(env.APP_TIMEZONE)].find(isValidTimezone) ?? DEFAULT_TIMEZONE;
  const cur = (CURRENCIES as readonly string[]).includes(r.base_currency ?? "")
    ? (r.base_currency as Currency)
    : "IDR";
  const days = Number(r.reminder_days);
  return {
    app_name: clean(r.app_name) ?? DEFAULT_APP_NAME,
    tagline: clean(r.tagline) ?? DEFAULT_TAGLINE,
    logo_data: isLogoDataUrl(r.logo_data) ? r.logo_data : null,
    timezone: tz,
    base_currency: cur,
    landing_enabled: r.landing_enabled ?? true,
    landing_tagline: clean(r.landing_tagline),
    github_url: isHttpsUrl(r.github_url) ? r.github_url : null,
    bot_default_account_id: clean(r.bot_default_account_id),
    bot_default_account_name: clean(env.BOT_DEFAULT_ACCOUNT),
    demo_url: isHttpsUrl(clean(env.PUBLIC_DEMO_URL)) ? clean(env.PUBLIC_DEMO_URL) : null,
    reminder_days:
      r.reminder_days != null && Number.isInteger(days) && days >= 1 && days <= 365 ? days : null,
    updated_at: r.updated_at ?? null,
  };
}

/** Cache-busting icon URL: the custom logo route when a logo is set, else the static favicon. */
export function logoUrl(s: Pick<ResolvedSettings, "logo_data" | "updated_at">): string {
  if (!s.logo_data) return DEFAULT_ICON;
  const v = s.updated_at ? Date.parse(s.updated_at) || 0 : 0;
  return `/api/public/app-icon?v=${v.toString(36)}`;
}

export function brandingOf(s: ResolvedSettings): Branding {
  return {
    app_name: s.app_name,
    tagline: s.tagline,
    logo_url: logoUrl(s),
    has_logo: !!s.logo_data,
    landing_enabled: s.landing_enabled,
    landing_tagline: s.landing_tagline,
    github_url: s.github_url,
    demo_url: s.demo_url,
  };
}

export type { AppSettingsInput } from "./app-settings-schema";

export const DEFAULT_BRANDING: Branding = brandingOf(resolveSettings(null, {}));

/** Picks the reminder window: explicit request value, then the setting, then the caller default. */
export function reminderDays(
  requested: number | null | undefined,
  setting: number | null,
  fallback: number,
): number {
  const n = requested ?? setting ?? fallback;
  return Math.min(365, Math.max(1, Math.round(n)));
}
