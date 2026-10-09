/**
 * Pure, client-safe catalog of integration settings that can be managed from Settings →
 * Integrasi (schema v16 `integration_settings`). The server resolves each key as
 * DB value (valid, decryptable) → env var → built-in default; secrets are encrypted at rest and
 * never sent back to the browser (only a short hint). Unit-tested in src/test/integrations.test.ts.
 *
 * Bootstrap/security values (SUPABASE_*, SESSION_SECRET, APP_USERNAME/APP_PASSWORD,
 * APP_TOTP_SECRET, DEMO_MODE, SENTRY_DSN, SETTINGS_ENCRYPTION_KEY) are deliberately NOT here:
 * they must exist before the database can be read, or they guard access to the settings themselves.
 */

export type IntegrationGroup = "telegram" | "ai" | "email" | "n8n";
export type IntegrationSource = "db" | "env" | "default" | "none";

export type IntegrationDef = {
  key: string;
  group: IntegrationGroup;
  secret: boolean;
  /** Indonesian i18n key. */
  label: string;
  /** Indonesian i18n key. */
  help: string;
  placeholder?: string;
  /** Built-in default used when neither DB nor env has a value. */
  default?: string;
  /** Returns an Indonesian i18n error key, or null when the (trimmed, non-empty) value is valid. */
  validate: (v: string) => string | null;
};

const MAX_LEN = 2000;
const CHAT_ID = /^-?\d{1,20}$/;
const NO_SPACE = /^\S+$/;
const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

/** "a,b , c" → ["a","b","c"] (empty pieces dropped). */
export function splitList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** BOT_ALLOWED_CHAT_IDS → list (empty = refuse every chat, fail-closed). */
export function parseAllowedChatIds(raw: string | null | undefined): string[] {
  return splitList(raw);
}

/** Fail-closed allow-list check: an empty list refuses every chat. */
export function isChatAllowed(raw: string | null | undefined, chatId: string | number): boolean {
  const list = parseAllowedChatIds(raw);
  return list.length > 0 && list.includes(String(chatId));
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** `Name <a@b.c>` or `a@b.c`. */
export function isEmailSender(v: string): boolean {
  const m = v.match(/^(.*)<([^<>]+)>$/);
  return EMAIL.test((m ? m[2]! : v).trim());
}

export const INTEGRATIONS: readonly IntegrationDef[] = [
  {
    key: "TELEGRAM_BOT_TOKEN",
    group: "telegram",
    secret: true,
    label: "Token bot Telegram",
    help: "Opsional. Dari @BotFather; dipakai mode langsung (webhook) tanpa n8n.",
    placeholder: "123456789:AA…",
    validate: (v) => (/^\d{5,15}:[\w-]{30,60}$/.test(v) ? null : "Format token bot tidak valid"),
  },
  {
    key: "BOT_ALLOWED_CHAT_IDS",
    group: "telegram",
    secret: false,
    label: "Chat ID yang diizinkan",
    help: "Pisahkan dengan koma. Kosong = semua chat ditolak.",
    placeholder: "123456789,987654321",
    validate: (v) => {
      const ids = splitList(v);
      if (!ids.length) return "Isi minimal satu chat ID";
      return ids.every((id) => CHAT_ID.test(id)) ? null : "Chat ID harus berupa angka";
    },
  },
  {
    key: "BOT_TEXT_AI",
    group: "telegram",
    secret: false,
    label: "AI untuk pesan chat",
    help: "auto = hanya saat ambigu, always = selalu, never = tidak pernah (foto tetap memakai AI).",
    default: "auto",
    validate: (v) =>
      ["auto", "always", "never"].includes(v.toLowerCase())
        ? null
        : "Pilih auto, always, atau never",
  },
  {
    key: "BOT_AI_DAILY_LIMIT",
    group: "telegram",
    secret: false,
    label: "Batas AI harian per chat",
    help: "Default 50, 0 = tanpa batas.",
    placeholder: "50",
    validate: (v) => (/^\d{1,6}$/.test(v) ? null : "Harus bilangan bulat ≥ 0"),
  },
  {
    key: "AI_API_URL",
    group: "ai",
    secret: false,
    label: "URL endpoint AI",
    help: "Endpoint chat-completions yang kompatibel OpenAI (diakhiri /chat/completions).",
    placeholder: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    validate: (v) => (isHttpUrl(v) ? null : "URL harus diawali http:// atau https://"),
  },
  {
    key: "AI_API_KEY",
    group: "ai",
    secret: true,
    label: "Kunci API AI",
    help: "Dikirim sebagai Authorization: Bearer.",
    validate: (v) =>
      NO_SPACE.test(v) && v.length <= 500 ? null : "Kunci tidak boleh berisi spasi",
  },
  {
    key: "AI_MODEL",
    group: "ai",
    secret: false,
    label: "Model AI (foto struk)",
    help: "Harus mendukung gambar (vision).",
    placeholder: "gemini-2.5-flash",
    validate: (v) => (NO_SPACE.test(v) && v.length <= 120 ? null : "Nama model tidak valid"),
  },
  {
    key: "AI_MODEL_TEXT",
    group: "ai",
    secret: false,
    label: "Model AI (teks chat)",
    help: "Opsional, model lebih murah untuk parsing chat. Default = model foto.",
    placeholder: "gemini-2.5-flash-lite",
    validate: (v) => (NO_SPACE.test(v) && v.length <= 120 ? null : "Nama model tidak valid"),
  },
  {
    key: "RESEND_API_KEY",
    group: "email",
    secret: true,
    label: "Kunci API Resend",
    help: "Untuk kirim email pengingat langsung.",
    placeholder: "re_…",
    validate: (v) =>
      NO_SPACE.test(v) && v.length <= 200 ? null : "Kunci tidak boleh berisi spasi",
  },
  {
    key: "EMAIL_FROM",
    group: "email",
    secret: false,
    label: "Pengirim email",
    help: "Domain harus sudah diverifikasi di Resend.",
    placeholder: "Dompetku <noreply@mail.example.com>",
    validate: (v) => (isEmailSender(v) ? null : "Alamat email tidak valid"),
  },
  {
    key: "EMAIL_TO",
    group: "email",
    secret: false,
    label: "Penerima email",
    help: "Pisahkan dengan koma.",
    placeholder: "you@example.com",
    validate: (v) => {
      const list = splitList(v);
      return list.length && list.every((e) => EMAIL.test(e)) ? null : "Alamat email tidak valid";
    },
  },
  {
    key: "N8N_API_KEY",
    group: "n8n",
    secret: true,
    label: "Kunci API n8n",
    help: "Minimal 24 karakter; dikirim n8n di header x-api-key.",
    validate: (v) =>
      NO_SPACE.test(v) && v.length >= 24 && v.length <= 500
        ? null
        : "Minimal 24 karakter tanpa spasi",
  },
] as const;

export type IntegrationKey =
  | "TELEGRAM_BOT_TOKEN"
  | "BOT_ALLOWED_CHAT_IDS"
  | "BOT_TEXT_AI"
  | "BOT_AI_DAILY_LIMIT"
  | "AI_API_URL"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "AI_MODEL_TEXT"
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  | "EMAIL_TO"
  | "N8N_API_KEY";

export const INTEGRATION_KEYS = INTEGRATIONS.map((d) => d.key) as IntegrationKey[];
export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = ["telegram", "ai", "email", "n8n"];

/** Never manageable from the UI (bootstrap / security values). */
export const FORBIDDEN_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
  "APP_USERNAME",
  "APP_PASSWORD",
  "APP_TOTP_SECRET",
  "DEMO_MODE",
  "SENTRY_DSN",
  "SETTINGS_ENCRYPTION_KEY",
] as const;

export function isIntegrationKey(k: unknown): k is IntegrationKey {
  return typeof k === "string" && (INTEGRATION_KEYS as string[]).includes(k);
}

export function integrationDef(key: IntegrationKey): IntegrationDef {
  return INTEGRATIONS.find((d) => d.key === key)!;
}

/** Normalises then validates a value for `key`. */
export function validateIntegration(
  key: IntegrationKey,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Nilai tidak boleh kosong" };
  if (value.length > MAX_LEN) return { ok: false, error: "Nilai terlalu panjang" };
  const def = integrationDef(key);
  const error = def.validate(value);
  if (error) return { ok: false, error };
  // Lists are stored normalised ("a, b" → "a,b"); BOT_TEXT_AI is case-insensitive.
  if (key === "BOT_ALLOWED_CHAT_IDS" || key === "EMAIL_TO")
    return { ok: true, value: splitList(value).join(",") };
  if (key === "BOT_TEXT_AI") return { ok: true, value: value.toLowerCase() };
  return { ok: true, value };
}

/**
 * Masked hint for a secret: "••••" + last 4 characters, only when the secret is long enough
 * (≥ 12) that 4 characters reveal nothing useful; otherwise just "••••".
 */
export function maskHint(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 12 ? `••••${value.slice(-4)}` : "••••";
}

/**
 * Precedence: a valid DB value wins, then a non-empty env var, then the built-in default.
 * An invalid DB value (e.g. edited by hand) is ignored rather than breaking the feature.
 */
export function resolveIntegration(
  key: IntegrationKey,
  dbValue: string | null | undefined,
  envValue: string | null | undefined,
): { value: string | undefined; source: IntegrationSource } {
  if (dbValue != null && dbValue.trim() !== "" && validateIntegration(key, dbValue).ok)
    return { value: dbValue.trim(), source: "db" };
  if (envValue != null && envValue !== "") return { value: envValue, source: "env" };
  const def = integrationDef(key).default;
  if (def !== undefined) return { value: def, source: "default" };
  return { value: undefined, source: "none" };
}

/** What the browser sees for one key — never a secret's plaintext. */
export type IntegrationStatus = {
  key: IntegrationKey;
  group: IntegrationGroup;
  secret: boolean;
  source: IntegrationSource;
  set: boolean;
  /** Non-secret effective value; null for secrets. */
  value: string | null;
  /** Secrets: masked hint of the effective value. */
  hint: string | null;
  /** True when a DB row exists (so "remove" falls back to env). */
  stored: boolean;
  updated_at: string | null;
  /** "decrypt" = stored secret cannot be decrypted (key rotated) → env used; "invalid" = bad DB value. */
  problem: "decrypt" | "invalid" | null;
};

/* ---------------- Ciphertext format ---------------- */

export const CIPHER_VERSION = "v1";
const B64URL = /^[A-Za-z0-9_-]+$/;

export type CipherParts = { version: "v1"; iv: string; tag: string; data: string };

/** `v1:<iv>:<tag>:<ciphertext>` (each base64url). */
export function formatCipher(p: Omit<CipherParts, "version">): string {
  return `${CIPHER_VERSION}:${p.iv}:${p.tag}:${p.data}`;
}

/** Parses the stored format; null for anything unknown or malformed (incl. future versions). */
export function parseCipher(s: string | null | undefined): CipherParts | null {
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) return null;
  const [, iv, tag, data] = parts as [string, string, string, string];
  if (![iv, tag, data].every((x) => B64URL.test(x))) return null;
  return { version: "v1", iv, tag, data };
}

/* ---------------- Connection tests ---------------- */

/** `…/chat/completions` → `…/models` (a free GET on OpenAI-compatible APIs). Null if not derivable. */
export function aiModelsUrl(chatUrl: string): string | null {
  try {
    const u = new URL(chatUrl);
    if (!/\/chat\/completions\/?$/.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\/chat\/completions\/?$/, "/models");
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}
