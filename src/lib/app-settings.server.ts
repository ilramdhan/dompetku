/**
 * Server-only access to the v14 `app_settings` row. Reads are cached in memory for ~60 s and
 * merged over env vars (APP_TIMEZONE, BOT_DEFAULT_ACCOUNT) and built-in defaults; a missing
 * table, missing env or any DB error falls back silently so nothing breaks before v14 is run.
 */
import { db } from "./db.server";
import {
  brandingOf,
  resolveSettings,
  type AppSettingsInput,
  type AppSettingsRow,
  type ResolvedSettings,
} from "./app-settings";

const TTL_MS = 60_000;
let cache: { at: number; value: ResolvedSettings; ready: boolean } | null = null;

function env() {
  return {
    APP_TIMEZONE: process.env["APP_TIMEZONE"],
    BOT_DEFAULT_ACCOUNT: process.env["BOT_DEFAULT_ACCOUNT"],
    PUBLIC_DEMO_URL: process.env["PUBLIC_DEMO_URL"],
  };
}

// finance.server imports this module for today(); load it lazily to avoid an import cycle.
const fin = () => import("./finance.server");

async function load(): Promise<{ value: ResolvedSettings; ready: boolean }> {
  try {
    const { isMissingTable } = await fin();
    const res = await db().from("app_settings").select("*").eq("id", 1).maybeSingle();
    if (res.error) {
      if (!isMissingTable(res.error)) console.warn("app_settings:", res.error.message);
      return { value: resolveSettings(null, env()), ready: !isMissingTable(res.error) };
    }
    return { value: resolveSettings(res.data as AppSettingsRow | null, env()), ready: true };
  } catch {
    // No Supabase env (e.g. preview) — env/defaults only.
    return { value: resolveSettings(null, env()), ready: false };
  }
}

/** Effective settings (cached ~60 s). Never throws. */
export async function getAppSettings(): Promise<ResolvedSettings> {
  return (await getAppSettingsState()).value;
}

export async function getAppSettingsState() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  cache = { at: Date.now(), ...(await load()) };
  return cache;
}

export function clearAppSettingsCache() {
  cache = null;
}

/** Synchronous best-effort view for hot paths (today()); env/defaults until first load. */
export function cachedAppSettings(): ResolvedSettings {
  if (!cache || Date.now() - cache.at >= TTL_MS) void getAppSettingsState();
  return cache?.value ?? resolveSettings(null, env());
}

export async function getBranding() {
  return brandingOf(await getAppSettings());
}

/** Full settings for the Settings page (authenticated). */
export async function readAppSettings() {
  clearAppSettingsCache();
  const { value, ready } = await getAppSettingsState();
  return {
    ready,
    settings: value,
    env: {
      timezone: process.env["APP_TIMEZONE"] || null,
      bot_default_account: process.env["BOT_DEFAULT_ACCOUNT"] || null,
    },
  };
}

export async function saveAppSettings(input: AppSettingsInput) {
  const { isMissingTable, logActivity } = await fin();
  const { invoice_prefix, ...base } = input;
  const write = (prefix: boolean) =>
    db()
      .from("app_settings")
      .upsert(
        {
          id: 1,
          ...base,
          ...(prefix && invoice_prefix !== undefined ? { invoice_prefix } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
  let res = await write(true);
  // v21 invoice_prefix is optional: before the section is run, save everything else.
  if (res.error && invoice_prefix !== undefined && /invoice_prefix/.test(res.error.message))
    res = await write(false);
  if (res.error) {
    if (isMissingTable(res.error))
      throw new Error("Tabel app_settings belum ada — jalankan bagian v14 di supabase/schema.sql.");
    throw new Error(res.error.message);
  }
  clearAppSettingsCache();
  await logActivity("app_settings.update", "app_settings", {
    name: input.app_name ?? undefined,
  });
  return readAppSettings();
}
