/**
 * Client-side cache of the last successful session check so client navigations
 * don't pay a server round-trip before every page. Security is still enforced
 * by `requireAuth` on every data server fn; an "Unauthorized" error clears this
 * cache and sends the user to /login (see router.tsx).
 */
export const SESSION_TTL_MS = 5 * 60_000;

/** UI-only session info (v18 role, forced password change, wallet levels); never trusted server-side. */
export type SessionInfo = {
  role?: "admin" | "member" | null;
  displayName?: string | null;
  mustChangePassword?: boolean;
  wallets?: Record<string, "view" | "manage"> | null;
};

let cached: ({ user: string | null; at: number } & SessionInfo) | null = null;

export function getCachedSession(now = Date.now()): ({ user: string | null } & SessionInfo) | null {
  if (typeof window === "undefined") return null; // never share across SSR requests
  if (!cached || now - cached.at > SESSION_TTL_MS) return null;
  const { at: _at, ...rest } = cached;
  return rest;
}

export function setCachedSession(
  user: string | null,
  now = Date.now(),
  info: SessionInfo = {},
): void {
  if (typeof window === "undefined") return;
  cached = { user, at: now, ...info };
}

export function clearSessionCache(): void {
  cached = null;
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof Error ? err.message === "Unauthorized" : false;
}

/** v18: a member must replace the temporary password before using the app. */
export function isPasswordChangeError(err: unknown): boolean {
  return err instanceof Error ? err.message === "PasswordChangeRequired" : false;
}
