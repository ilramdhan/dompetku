/**
 * Pure, client-safe helpers for multi-user management (v18, unit-tested): username rules, input
 * schemas for the admin "Pengguna" card and the permission-matrix diff. Server work lives in
 * users.server.ts; the permission resolver in permissions.ts.
 */
import { z } from "zod";
import { PASSWORD_MAX } from "./password";
import { LEVELS, type Level } from "./permissions";

/** Member usernames: lower-case, 3–32 chars of a-z 0-9 . _ - (immutable after creation). */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/** Problems with a new member username (i18n keys); empty = ok. */
export function usernameProblems(username: string, owner: string | null): string[] {
  const u = normalizeUsername(username);
  const out: string[] = [];
  if (!USERNAME_RE.test(u))
    out.push("Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip");
  if (owner && u === owner.trim().toLowerCase()) out.push("Username sudah dipakai");
  return out;
}

const optName = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().max(80).nullable(),
);

export const createMemberSchema = z.object({
  username: z.string().min(1).max(64),
  display_name: optName,
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX + 1),
});
export type CreateMemberInput = z.output<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  id: z.string().uuid(),
  display_name: optName.optional(),
  is_active: z.boolean().optional(),
});
export type UpdateMemberInput = z.output<typeof updateMemberSchema>;

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX + 1),
});

export const permissionsSchema = z.object({
  id: z.string().uuid(),
  grants: z.array(z.object({ account_id: z.string().uuid(), level: z.enum(LEVELS) })).max(500),
});
export type GrantInput = { account_id: string; level: Level };

/** One grant per account (last wins), so the stored set is exactly what the matrix shows. */
export function dedupeGrants(grants: readonly GrantInput[]): GrantInput[] {
  const m = new Map<string, Level>();
  for (const g of grants) m.set(g.account_id, g.level);
  return [...m.entries()]
    .map(([account_id, level]) => ({ account_id, level }))
    .sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
}

/** Matrix cell value → grant level (none = no row). */
export type MatrixValue = "none" | Level;

/** Grants from the matrix state (accounts without access are omitted). */
export function grantsFromMatrix(state: Readonly<Record<string, MatrixValue>>): GrantInput[] {
  return dedupeGrants(
    Object.entries(state)
      .filter((e): e is [string, Level] => e[1] === "view" || e[1] === "manage")
      .map(([account_id, level]) => ({ account_id, level })),
  );
}

/** Name shown for a user: full name, else username. */
export function displayNameOf(u: { display_name?: string | null; username: string }): string {
  return u.display_name?.trim() || u.username;
}
