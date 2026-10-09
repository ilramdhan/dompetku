/**
 * Server-only access to integration settings (schema v16 `integration_settings`).
 * Precedence per key: valid DB value → env var → built-in default (see resolveIntegration).
 * DB rows are cached ~60 s per instance and cleared on every write; env is read live, so
 * instances with only env vars (or no v16 table, or a DB error) behave exactly as before.
 * Secrets are AES-256-GCM encrypted (secret-box.server.ts) and never leave the server: the
 * status sent to the browser only carries a masked hint.
 */
import { db } from "./db.server";
import { logError } from "./monitoring.server";
import { decryptSecret, encryptSecret, settingsKey } from "./secret-box.server";
import {
  INTEGRATIONS,
  integrationDef,
  maskHint,
  resolveIntegration,
  validateIntegration,
  type IntegrationKey,
  type IntegrationStatus,
} from "./integrations";

const TTL_MS = 60_000;

type StoredRow = {
  /** Plaintext (decrypted for secrets); null when a secret could not be decrypted. */
  value: string | null;
  secret: boolean;
  updated_at: string | null;
};
type Snapshot = { at: number; ready: boolean; rows: Map<string, StoredRow> };

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

const fin = () => import("./finance.server");

async function load(): Promise<Snapshot> {
  const rows = new Map<string, StoredRow>();
  try {
    const res = await db().from("integration_settings").select("key,value,is_secret,updated_at");
    if (res.error) {
      const { isMissingTable } = await fin();
      const missing = isMissingTable(res.error);
      if (!missing) logError("integrations:load", new Error(res.error.message));
      return { at: Date.now(), ready: !missing, rows };
    }
    for (const r of (res.data ?? []) as {
      key: string;
      value: string;
      is_secret: boolean;
      updated_at: string;
    }[]) {
      rows.set(r.key, {
        value: r.is_secret ? decryptSecret(r.value, r.key) : r.value,
        secret: r.is_secret,
        updated_at: r.updated_at,
      });
    }
    return { at: Date.now(), ready: true, rows };
  } catch (e) {
    // No Supabase env (e.g. preview/tests) — env/defaults only.
    if (!(e instanceof Error && /SUPABASE_URL/.test(e.message))) logError("integrations:load", e);
    return { at: Date.now(), ready: false, rows };
  }
}

async function snapshot(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  inflight ??= load().finally(() => (inflight = null));
  cache = await inflight;
  return cache;
}

export function clearIntegrationsCache() {
  cache = null;
}

const envOf = (key: IntegrationKey) => process.env[key];

/** Effective value of one integration setting (DB → env → default). Never throws. */
export async function getIntegration(key: IntegrationKey): Promise<string | undefined> {
  const s = await snapshot();
  return resolveIntegration(key, s.rows.get(key)?.value, envOf(key)).value;
}

/** Effective values of several keys at once (one cache read). */
export async function getIntegrations<K extends IntegrationKey>(
  keys: readonly K[],
): Promise<Record<K, string | undefined>> {
  const s = await snapshot();
  const out = {} as Record<K, string | undefined>;
  for (const k of keys) out[k] = resolveIntegration(k, s.rows.get(k)?.value, envOf(k)).value;
  return out;
}

/** Browser-safe status of every managed key (no secret plaintext). */
export async function readIntegrations(): Promise<{
  ready: boolean;
  canEncrypt: boolean;
  items: IntegrationStatus[];
}> {
  clearIntegrationsCache();
  const s = await snapshot();
  const items = INTEGRATIONS.map((d): IntegrationStatus => {
    const key = d.key as IntegrationKey;
    const row = s.rows.get(key);
    const r = resolveIntegration(key, row?.value, envOf(key));
    const problem: IntegrationStatus["problem"] = !row
      ? null
      : row.value == null
        ? "decrypt"
        : r.source !== "db"
          ? "invalid"
          : null;
    return {
      key,
      group: d.group,
      secret: d.secret,
      source: r.source,
      set: r.value !== undefined && r.source !== "default",
      value: d.secret ? null : (r.value ?? null),
      hint: d.secret ? maskHint(r.value) : null,
      stored: !!row,
      updated_at: row?.updated_at ?? null,
      problem,
    };
  });
  return { ready: s.ready, canEncrypt: settingsKey() !== null, items };
}

const MISSING =
  "Tabel integration_settings belum ada — jalankan bagian v16 di supabase/schema.sql.";

export async function saveIntegration(key: IntegrationKey, raw: string) {
  const v = validateIntegration(key, raw);
  if (!v.ok) throw new Error(v.error);
  const def = integrationDef(key);
  const value = def.secret ? encryptSecret(v.value, key) : v.value;
  const { isMissingTable, logActivity } = await fin();
  const res = await db()
    .from("integration_settings")
    .upsert(
      { key, value, is_secret: def.secret, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (res.error) throw new Error(isMissingTable(res.error) ? MISSING : res.error.message);
  clearIntegrationsCache();
  // Never log the value — only which setting changed.
  await logActivity("integration.update", "integration_settings", { name: key });
  return readIntegrations();
}

export async function removeIntegration(key: IntegrationKey) {
  const { isMissingTable, logActivity } = await fin();
  const res = await db().from("integration_settings").delete().eq("key", key);
  if (res.error) throw new Error(isMissingTable(res.error) ? MISSING : res.error.message);
  clearIntegrationsCache();
  await logActivity("integration.delete", "integration_settings", { name: key });
  return readIntegrations();
}
