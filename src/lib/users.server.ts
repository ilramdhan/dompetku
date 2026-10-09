/**
 * Server-only access to v17 `app_users` (profile, password hash, session version).
 *
 * Back-compat rules:
 * - The APP_USERNAME user is always the owner/admin. Without a row (or without the v17 table) the
 *   profile is empty and login uses APP_PASSWORD exactly as before; the row is created lazily on
 *   the first profile save or password change, never on login.
 * - A missing table or missing Supabase env never locks anyone out (treated as "no row").
 * - `APP_PASSWORD_RESET=true` ignores the stored hash so APP_PASSWORD works again (recovery).
 *
 * v18 multi-user: family members are rows with role 'member', their own scrypt hash and
 * `must_change_password`. A member cookie carries `r: "member"` and is valid only while the row
 * exists, is active, and its session_version matches (fail closed, cached ~30 s). Wallet grants
 * come from `account_permissions`. The owner can never be demoted, deactivated or deleted.
 */
import { db } from "./db.server";
import { isMissingTable, logActivity } from "./finance.server";
import { logError } from "./monitoring.server";
import { hashPassword, safeEqual, verifyPassword } from "./password.server";
import { passwordProblems } from "./password";
import { missingColumn } from "./backup";
import type { TablesUpdate } from "./database.types";
import { ADMIN_ACCESS, grantsFromRows, type Access, type Level } from "./permissions";
import { dedupeGrants, normalizeUsername, usernameProblems, type GrantInput } from "./users";
import { resolveProfile, type Profile, type ProfileInput, type ProfileRow } from "./profile";

const SV_TTL_MS = 45_000;

type UserRow = ProfileRow & {
  id: string;
  password_hash: string | null;
  session_version: number;
  is_active: boolean;
  must_change_password?: boolean | null | undefined;
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

const BASE_COLS =
  "id,username,display_name,address,avatar,role,is_active,password_hash,session_version,updated_at";
// v18 column; once reported missing it is no longer selected on this instance.
let mustChangeMissing = false;

async function lookupBy(col: "username" | "id", value: string): Promise<Lookup> {
  let client;
  try {
    client = db();
  } catch {
    return { state: "missing" };
  }
  try {
    const run = () =>
      client
        .from("app_users")
        .select(mustChangeMissing ? BASE_COLS : `${BASE_COLS},must_change_password`)
        .eq(col, value)
        .maybeSingle();
    let res = await run();
    if (res.error && !mustChangeMissing && missingColumn(res.error) === "must_change_password") {
      mustChangeMissing = true;
      res = await run();
    }
    if (res.error) {
      if (isMissingTable(res.error)) return { state: "missing" };
      return { state: "error", message: res.error.message };
    }
    return { state: "ok", row: (res.data as unknown as UserRow | null) ?? null };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

const lookup = (username: string) => lookupBy("username", username);

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

/* ---------------- principal (v18) ---------------- */

export type Principal = {
  username: string;
  /** app_users.id; null for the owner without a v17 row. */
  userId: string | null;
  role: "admin" | "member";
  displayName: string | null;
  /** Member must change the temporary password before using the app. */
  mustChangePassword: boolean;
  access: Access;
};

const MEMBER_TTL_MS = 30_000;
type MemberState = {
  id: string;
  username: string;
  display_name: string | null;
  sv: number;
  mustChange: boolean;
  grants: Record<string, Level>;
};
const memberCache = new Map<string, { at: number; state: MemberState | null }>();

/** Drops cached member state (after admin changes) so this instance re-reads it immediately. */
export function forgetMember(username?: string) {
  if (username) memberCache.delete(username);
  else memberCache.clear();
}

async function loadGrants(userId: string): Promise<Record<string, Level> | "error"> {
  const res = await db()
    .from("account_permissions")
    .select("account_id, level")
    .eq("user_id", userId);
  if (res.error) return isMissingTable(res.error) ? {} : "error";
  return grantsFromRows(res.data);
}

/**
 * Active member state for a username, or null (no row, not a member, inactive, table missing).
 * Cached ~30 s per instance. Transient DB errors keep the last known state but never invent one:
 * without a cached state the member is refused (fail closed).
 */
export async function memberState(username: string, now = Date.now()): Promise<MemberState | null> {
  const hit = memberCache.get(username);
  if (hit && now - hit.at < MEMBER_TTL_MS) return hit.state;
  let state: MemberState | null = null;
  const owner = process.env["APP_USERNAME"] ?? "";
  const r = await lookup(username);
  if (r.state === "error") {
    logError("auth.member_state", new Error(r.message));
    return hit?.state ?? null;
  }
  const row = r.state === "ok" ? r.row : null;
  if (
    row &&
    row.role === "member" &&
    row.is_active &&
    row.username.toLowerCase() !== owner.toLowerCase()
  ) {
    const grants = await loadGrants(row.id);
    if (grants === "error") return hit?.state ?? null;
    state = {
      id: row.id,
      username: row.username,
      display_name: row.display_name ?? null,
      sv: row.session_version,
      mustChange: !!row.must_change_password,
      grants,
    };
  }
  memberCache.set(username, { at: now, state });
  return state;
}

/**
 * Resolves a signed cookie into the request principal. Owner cookies (no `r`) are valid only for
 * the APP_USERNAME user with a matching session_version (no row/table = valid, as before v17).
 * Member cookies need an active member row with the same session_version.
 */
export async function resolvePrincipal(s: {
  u: string;
  sv?: number;
  r?: "member";
  i?: string;
}): Promise<Principal | null> {
  const owner = process.env["APP_USERNAME"];
  if (!owner) return null;
  if (s.r === "member") {
    if (s.u.toLowerCase() === owner.toLowerCase()) return null;
    const m = await memberState(s.u);
    // Bound to the row id: a deleted member's cookie never matches a re-created username.
    if (!m || s.sv === undefined || s.sv !== m.sv || !s.i || s.i !== m.id) return null;
    return {
      username: m.username,
      userId: m.id,
      role: "member",
      displayName: m.display_name,
      mustChangePassword: m.mustChange,
      access: { role: "member", grants: m.grants },
    };
  }
  if (s.u !== owner) return null;
  const { sessionVersionValid } = await import("./session");
  if (!sessionVersionValid(s.sv, await currentSessionVersion(s.u))) return null;
  return {
    username: s.u,
    userId: null,
    role: "admin",
    displayName: null,
    mustChangePassword: false,
    access: ADMIN_ACCESS,
  };
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

// Hash of a random password, verified when the member does not exist so timing stays similar.
let dummyHash: Promise<string> | null = null;

export type LoginResult =
  | { ok: false }
  | { ok: true; role: "admin"; username: string }
  | { ok: true; role: "member"; id: string; username: string; sv: number; mustChange: boolean };

/**
 * Full login check (v18): the owner (exact APP_USERNAME, see checkCredentials) first, else an
 * active member by lower-cased username with its own scrypt hash. Inactive members, rows that
 * are not members and missing tables never log in.
 */
export async function authenticate(username: string, password: string): Promise<LoginResult> {
  const owner = ownerUsername();
  if (await checkCredentials(username, password)) return { ok: true, role: "admin", username };
  const name = normalizeUsername(username);
  if (!name || name === owner.toLowerCase()) return { ok: false };
  const r = await lookup(name);
  const row = r.state === "ok" ? r.row : null;
  const hash = row?.password_hash ?? null;
  if (!row || !hash) {
    dummyHash ??= hashPassword(`dummy-${Math.random()}`);
    await verifyPassword(password, await dummyHash);
    return { ok: false };
  }
  const okP = await verifyPassword(password, hash);
  if (!okP || row.role !== "member" || !row.is_active) return { ok: false };
  forgetMember(row.username);
  return {
    ok: true,
    role: "member",
    id: row.id,
    username: row.username,
    sv: row.session_version,
    mustChange: !!row.must_change_password,
  };
}

/* ---------------- profile ---------------- */

export type ProfileState = {
  ready: boolean;
  profile: Profile;
  has_db_password: boolean;
  reset_mode: boolean;
  /** v18: the member must change the temporary password first. */
  must_change_password: boolean;
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
    reset_mode: owner ? passwordResetMode() : false,
    must_change_password: !owner && !!row?.must_change_password,
  };
}

const MISSING = "Tabel app_users belum ada — jalankan bagian v17 di supabase/schema.sql.";

export async function saveProfile(
  username: string,
  input: ProfileInput,
  role: "admin" | "member" = "admin",
): Promise<ProfileState> {
  if (role === "member") {
    // Members edit their own row only (never role/username/is_active); the row must exist.
    const upd = await db()
      .from("app_users")
      .update({
        display_name: input.display_name,
        address: input.address,
        avatar: input.avatar,
        updated_at: new Date().toISOString(),
      })
      .eq("username", username)
      .eq("role", "member")
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data?.length) throw new Error("Unauthorized");
    forgetMember(username);
    await logActivity("profile.update", "app_users", null);
    return getProfileState(username);
  }
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
  role: "admin" | "member" = "admin",
): Promise<ChangePasswordResult> {
  if (role === "member") return changeMemberPassword(username, current, next);
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

/** Member password change (also completes the forced first-login change). */
async function changeMemberPassword(
  username: string,
  current: string,
  next: string,
): Promise<ChangePasswordResult> {
  const r = await lookup(username);
  if (r.state === "missing") throw new Error(MISSING);
  if (r.state === "error") throw new Error(r.message);
  const row = r.row;
  if (!row || row.role !== "member" || !row.is_active || !row.password_hash)
    throw new Error("Unauthorized");
  if (!(await verifyPassword(current, row.password_hash)))
    return { ok: false, error: "Password saat ini salah" };
  const problems = passwordProblems(next, { username, current });
  if (problems.length) return { ok: false, error: problems[0]! };
  const sv = row.session_version + 1;
  const patch: TablesUpdate<"app_users"> = {
    password_hash: await hashPassword(next),
    session_version: sv,
    updated_at: new Date().toISOString(),
  };
  if (!mustChangeMissing) patch.must_change_password = false;
  const upd = await db()
    .from("app_users")
    .update(patch)
    .eq("id", row.id)
    .eq("session_version", row.session_version)
    .select("id");
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data?.length) throw new Error("Profil berubah di tempat lain, coba lagi.");
  forgetMember(username);
  await logActivity("auth.password_change", "auth", null);
  return { ok: true, session_version: sv };
}

/* ---------------- user management (admin, v18) ---------------- */

const MISSING_V18 =
  "Fitur multi-user belum aktif — jalankan bagian v17 dan v18 di supabase/schema.sql.";

export type ManagedUser = {
  id: string | null;
  username: string;
  display_name: string | null;
  role: "admin" | "member";
  is_active: boolean;
  must_change_password: boolean;
  owner: boolean;
  created_at: string | null;
  grants: { account_id: string; level: Level }[];
};

export type UsersState = { ready: boolean; users: ManagedUser[] };

/** Owner + every member with their wallet grants. `ready: false` before v17/v18. */
export async function listUsers(): Promise<UsersState> {
  const owner = ownerUsername();
  const ownerEntry = (row?: Partial<UserRow> | null): ManagedUser => ({
    id: row?.id ?? null,
    username: owner,
    display_name: row?.display_name ?? null,
    role: "admin",
    is_active: true,
    must_change_password: false,
    owner: true,
    created_at: null,
    grants: [],
  });
  const users = await db()
    .from("app_users")
    .select("id, username, display_name, role, is_active, must_change_password, created_at")
    .order("created_at");
  if (users.error) {
    if (isMissingTable(users.error) || missingColumn(users.error) === "must_change_password")
      return { ready: false, users: [ownerEntry()] };
    throw new Error(users.error.message);
  }
  const perms = await db().from("account_permissions").select("user_id, account_id, level");
  if (perms.error) {
    if (isMissingTable(perms.error)) return { ready: false, users: [ownerEntry()] };
    throw new Error(perms.error.message);
  }
  const rows = users.data ?? [];
  const ownerRow = rows.find((u) => u.username === owner);
  const members: ManagedUser[] = rows
    .filter((u) => u.username !== owner && u.role === "member")
    .map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role: "member",
      is_active: u.is_active,
      must_change_password: !!u.must_change_password,
      owner: false,
      created_at: u.created_at,
      grants: dedupeGrants(
        (perms.data ?? [])
          .filter((p) => p.user_id === u.id)
          .map((p) => ({ account_id: p.account_id, level: p.level })),
      ),
    }));
  return { ready: true, users: [ownerEntry(ownerRow), ...members] };
}

/** Loads a member row by id, refusing the owner and non-members. */
async function memberRow(id: string): Promise<UserRow> {
  const r = await lookupBy("id", id);
  if (r.state === "missing") throw new Error(MISSING_V18);
  if (r.state === "error") throw new Error(r.message);
  const row = r.row;
  if (!row) throw new Error("Pengguna tidak ditemukan");
  if (row.username.toLowerCase() === ownerUsername().toLowerCase() || row.role !== "member")
    throw new Error("Pemilik tidak bisa diubah dari sini");
  return row;
}

export async function createMember(input: {
  username: string;
  display_name: string | null;
  password: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const username = normalizeUsername(input.username);
  const bad = usernameProblems(username, ownerUsername());
  if (bad.length) return { ok: false, error: bad[0]! };
  const problems = passwordProblems(input.password, { username });
  if (problems.length) return { ok: false, error: problems[0]! };
  const ins = await db()
    .from("app_users")
    .insert({
      username,
      display_name: input.display_name,
      role: "member",
      is_active: true,
      must_change_password: true,
      password_hash: await hashPassword(input.password),
      session_version: 1,
    })
    .select("id")
    .single();
  if (ins.error) {
    if (isMissingTable(ins.error) || missingColumn(ins.error)) throw new Error(MISSING_V18);
    if (/duplicate key|23505/i.test(ins.error.message))
      return { ok: false, error: "Username sudah dipakai" };
    throw new Error(ins.error.message);
  }
  await logActivity("user.create", "app_users", { name: username });
  return { ok: true, id: ins.data.id };
}

/** Bumps session_version with an optimistic check; the member's cookies die immediately. */
async function bump(row: UserRow, patch: TablesUpdate<"app_users">) {
  const upd = await db()
    .from("app_users")
    .update({
      ...patch,
      session_version: row.session_version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("session_version", row.session_version)
    .select("id");
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data?.length) throw new Error("Profil berubah di tempat lain, coba lagi.");
  forgetMember(row.username);
}

/** Full name and/or active flag. Deactivating logs the member out everywhere. */
export async function updateMember(input: {
  id: string;
  display_name?: string | null | undefined;
  is_active?: boolean | undefined;
}) {
  const row = await memberRow(input.id);
  const patch: TablesUpdate<"app_users"> = {};
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (!Object.keys(patch).length) return { ok: true };
  if (input.is_active !== undefined && input.is_active !== row.is_active) await bump(row, patch);
  else {
    const upd = await db()
      .from("app_users")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (upd.error) throw new Error(upd.error.message);
    forgetMember(row.username);
  }
  await logActivity("user.update", "app_users", {
    name: row.username,
    ...(input.is_active !== undefined ? { active: input.is_active } : {}),
  });
  return { ok: true };
}

/** New temporary password: must be changed on next login; every session is logged out. */
export async function resetMemberPassword(
  id: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await memberRow(id);
  const problems = passwordProblems(password, { username: row.username });
  if (problems.length) return { ok: false, error: problems[0]! };
  await bump(row, { password_hash: await hashPassword(password), must_change_password: true });
  await logActivity("user.password_reset", "app_users", { name: row.username });
  return { ok: true };
}

export async function deleteMember(id: string) {
  const row = await memberRow(id);
  const del = await db().from("app_users").delete().eq("id", row.id).eq("role", "member");
  if (del.error) throw new Error(del.error.message);
  forgetMember(row.username);
  await logActivity("user.delete", "app_users", { name: row.username });
  return { ok: true };
}

/**
 * Replaces a member's wallet grants with exactly `grants` (unknown account ids are refused).
 * Delete-then-insert; on an insert failure the previous grants are restored.
 */
export async function setMemberPermissions(id: string, grants: GrantInput[]) {
  const row = await memberRow(id);
  const list = dedupeGrants(grants);
  if (list.length) {
    const ids = list.map((g) => g.account_id);
    const acc = await db().from("accounts").select("id").in("id", ids);
    if (acc.error) throw new Error(acc.error.message);
    if ((acc.data ?? []).length !== ids.length) throw new Error("Akun tidak ditemukan");
  }
  const prev = await db()
    .from("account_permissions")
    .select("account_id, level")
    .eq("user_id", row.id);
  if (prev.error) {
    if (isMissingTable(prev.error)) throw new Error(MISSING_V18);
    throw new Error(prev.error.message);
  }
  const del = await db().from("account_permissions").delete().eq("user_id", row.id);
  if (del.error) throw new Error(del.error.message);
  if (list.length) {
    const ins = await db()
      .from("account_permissions")
      .insert(list.map((g) => ({ user_id: row.id, account_id: g.account_id, level: g.level })));
    if (ins.error) {
      if (prev.data?.length)
        await db()
          .from("account_permissions")
          .insert(
            prev.data.map((g) => ({ user_id: row.id, account_id: g.account_id, level: g.level })),
          );
      throw new Error(ins.error.message);
    }
  }
  forgetMember(row.username);
  await logActivity("permission.update", "app_users", { name: row.username, rows: list.length });
  return { ok: true, count: list.length };
}
