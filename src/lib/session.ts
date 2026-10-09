/**
 * Pure session payload helpers (client-safe, unit-tested). The cookie is
 * `base64url(JSON {u, exp, sv?}).hmac`; signing lives in session.server.ts.
 *
 * `sv` is the user's session_version at login (v17 `app_users`). Cookies issued before v17 have no
 * `sv` and stay valid while the user's version is still 1 or there is no user row, so upgrading
 * never logs anyone out; a password change bumps the version and invalidates every older cookie.
 */
export type SessionData = { u: string; exp: number; sv?: number };

/** Validates a decoded cookie payload; null when malformed or expired. */
export function parseSessionData(raw: unknown, now = Date.now()): SessionData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d["u"] !== "string" || !d["u"]) return null;
  if (typeof d["exp"] !== "number" || d["exp"] < now) return null;
  const sv = d["sv"];
  if (sv !== undefined && !(typeof sv === "number" && Number.isInteger(sv) && sv >= 1)) return null;
  return sv === undefined ? { u: d["u"], exp: d["exp"] } : { u: d["u"], exp: d["exp"], sv };
}

/**
 * Whether a cookie's `sv` is still current. `current` null = no user row / table missing /
 * lookup failed: behave exactly as before v17 (valid).
 */
export function sessionVersionValid(sv: number | undefined, current: number | null): boolean {
  if (current === null) return true;
  return (sv ?? 1) === current;
}
