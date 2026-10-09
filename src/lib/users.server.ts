/**
 * Server-only access to v17 `app_users` (profile, password hash, session version).
 *
 * Back-compat rules:
 * - The APP_USERNAME user is always the owner/admin. Without a row (or without the v17 table) the
 *   profile is empty and login uses APP_PASSWORD exactly as before; the row is created lazily on
 *   the first profile save or password change, never on login.
 * - A missing table or missing Supabase env never locks anyone out (treated as "no row").
 * - `APP_PASSWORD_RESET=true` ignores the stored hash so APP_PASSWORD works again (recovery).
 */
import { db } from "./db.server";
import { isMissingTable, logActivity } from "./finance.server";
import { logError } from "./monitoring.server";
import { hashPassword, safeEqual, verifyPassword } from "./password.server";
import { passwordProblems } from "./password";
import { resolveProfile, type Profile, type ProfileInput, type ProfileRow } from "./profile";

const SV_TTL_MS = 45_000;

type UserRow = ProfileRow & {
  id: string;
  password_hash: string | null;
  session_version: number;
  is_active: boolean;
};

type Lookup =
  | { state: "ok"; row: UserRow | null }
  | { state: "missing" } // table not created (v17 not run) or no Supabase env
  | { state: "error"; message: string };

export function ownerUsername(): string {
  const u = process.env["APP_USERNAME"];
  if (!u) throw new Error("APP_USERNAME dan APP_PASSWORD belum diatur.");
  return u;
}

function envPassword(): string {
  const p = process.env["APP_PASSWORD"];
  if (!p || !process.env["APP_USERNAME"])
    throw new Error("APP_USERNAME dan APP_PASSWORD belum diatur.");
  return p;
}

/** Recovery switch: when on, the stored hash is ignored and APP_PASSWORD works again. */
export function passwordResetMode(): boolean {
  return process.env["APP_PASSWORD_RESET"]?.trim().toLowerCase() === "true";
}

async function lookup(username: string): Promise<Lookup> {
  let client;
  try {
    client = db();
  } catch {
    return { state: "missing" };
  }
  try {
    const res = await client
      .from("app_users")
      .select(
        "id,username,display_name,address,avatar,role,is_active,password_hash,session_version,updated_at",
      )
      .eq("username", username)
      .maybeSingle();
    if (res.error) {
      if (isMissingTable(res.error)) return { state: "missing" };
      return { state: "error", message: res.error.message };
    }
    return { state: "ok", row: (res.data as UserRow | null) ?? null };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- session version (cached for requireAuth) ---------------- */

const svCache = new Map<string, { at: number; sv: number | null }>();

/**
 * Current session_version for a user, or null when there is no row / no table (= pre-v17
 * behaviour, every signed cookie is valid). Cached ~45 s per instance; on a transient DB error
 * the last known value is kept (or null), so auth never fails closed because of the table.
 */
export async function currentSessionVersion(
  username: string,
  now = Date.now(),
): Promise<number | null> {
  const hit = svCache.get(username);
  if (hit && now - hit.at < SV_TTL_MS) return hit.sv;
  const r = await lookup(username);
  let sv: number | null;
  if (r.state === "ok") sv = r.row ? r.row.session_version : null;
  else if (r.state === "missing") sv = null;
  else {
    logError("auth.session_version", new Error(r.message));
    sv = hit?.sv ?? null;
  }
  svCache.set(username, { at: now, sv });
  return sv;
}

export function setCachedSessionVersion(username: string, sv: number | null) {
  svCache.set(username, { at: Date.now(), sv });
}

export function forgetSessionVersion(username: string) {
  svCache.delete(username);
}

export function clearSessionVersionCache() {
  svCache.clear();
}

/* ---------------- credentials ---------------- */

/**
 * Login check. The env user's stored hash (v17) wins over APP_PASSWORD; without a hash (no row,
 * no table, or APP_PASSWORD_RESET=true) APP_PASSWORD is compared in constant time as before.
 * The row is looked up for the env username regardless of the typed one, so timing doesn't
 * reveal whether the username was right. A DB error with an unknown hash state refuses login
 * rather than silently accepting an old env password.
 */
export async function checkCredentials(
  username: string,
  password: string,
  opts: { audit?: boolean } = {},
): Promise<boolean> {
  const u = ownerUsername();
  const p = envPassword();
  const okU = safeEqual(username, u);
  const reset = passwordResetMode();
  const r = reset ? ({ state: "missing" } as const) : await lookup(u);
  if (r.state === "error") {
    logError("auth.check_credentials", new Error(r.message));
    safeEqual(password, p);
    return false;
  }
  const hash = r.state === "ok" ? r.row?.password_hash : null;
  const okP = hash ? await verifyPassword(password, hash) : safeEqual(password, p);
  if (okU && okP && reset && opts.audit !== false) {
    console.warn(
      JSON.stringify({ level: "warn", scope: "auth", msg: "login with APP_PASSWORD_RESET=true" }),
    );
    await logActivity("auth.password_reset_login", "auth", null);
  }
  return okU && okP;
}

/* ---------------- profile ---------------- */

export type ProfileState = {
  ready: boolean;
  profile: Profile;
  has_db_password: boolean;
  reset_mode: boolean;
};

export async function getProfileState(username: string): Promise<ProfileState> {
  const owner = username === ownerUsername();
  const r = await lookup(username);
  if (r.state === "error") throw new Error(r.message);
  const row = r.state === "ok" ? r.row : null;
  return {
    ready: r.state === "ok",
    profile: resolveProfile(username, row, owner),
    has_db_password: !!row?.password_hash,
    reset_mode: passwordResetMode(),
  };
}

const MISSING = "Tabel app_users belum ada — jalankan bagian v17 di supabase/schema.sql.";

export async function saveProfile(username: string, input: ProfileInput): Promise<ProfileState> {
  if (username !== ownerUsername()) throw new Error("Unauthorized");
  // Upsert on username: creates the owner row on first save (role defaults to admin) and never
  // touches password_hash / session_version.
  const res = await db().from("app_users").upsert(
    {
      username,
      display_name: input.display_name,
      address: input.address,
      avatar: input.avatar,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "username" },
  );
  if (res.error) {
    if (isMissingTable(res.error)) throw new Error(MISSING);
    throw new Error(res.error.message);
  }
  await logActivity("profile.update", "app_users", null);
  return getProfileState(username);
}

export type ChangePasswordResult =
  { ok: true; session_version: number } | { ok: false; error: string };

/**
 * Verifies the current password (DB hash if set, else APP_PASSWORD), applies the policy, stores
 * a new scrypt hash and bumps session_version so every other session is logged out.
 */
export async function changePassword(
  username: string,
  current: string,
  next: string,
): Promise<ChangePasswordResult> {
  if (username !== ownerUsername()) throw new Error("Unauthorized");
  const r = await lookup(username);
  if (r.state === "missing") throw new Error(MISSING);
  if (r.state === "error") throw new Error(r.message);

  if (!(await checkCredentials(username, current, { audit: false })))
    return { ok: false, error: "Password saat ini salah" };
  const problems = passwordProblems(next, { username, current });
  if (problems.length) return { ok: false, error: problems[0]! };

  const password_hash = await hashPassword(next);
  const now = new Date().toISOString();
  let sv: number;
  if (r.row) {
    sv = r.row.session_version + 1;
    const upd = await db()
      .from("app_users")
      .update({ password_hash, session_version: sv, updated_at: now })
      .eq("id", r.row.id)
      .eq("session_version", r.row.session_version)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data?.length) throw new Error("Profil berubah di tempat lain, coba lagi.");
  } else {
    // Old cookies carry no sv (= 1), so starting at 2 logs out every existing session.
    sv = 2;
    const ins = await db()
      .from("app_users")
      .insert({ username, password_hash, session_version: sv, updated_at: now });
    if (ins.error) throw new Error(ins.error.message);
  }
  setCachedSessionVersion(username, sv);
  await logActivity("auth.password_change", "auth", null);
  return { ok: true, session_version: sv };
}
