/**
 * Pure session payload helpers (client-safe, unit-tested). The cookie is
 * `base64url(JSON {u, exp, sv?}).hmac`; signing lives in session.server.ts.
 *
 * `sv` is the user's session_version at login (v17 `app_users`). Cookies issued before v17 have no
 * `sv` and stay valid while the user's version is still 1 or there is no user row, so upgrading
 * never logs anyone out; a password change bumps the version and invalidates every older cookie.
 *
 * `r: "member"` (v18) marks a family member's cookie. The owner's cookie never carries it, so a
 * member cookie can never be read as the owner's (and an owner cookie never as a member's).
 * `i` (member cookies only) is the app_users.id the cookie was issued for, so a cookie of a deleted
 * member never comes back to life for a new member re-created with the same username.
 */
export type SessionData = { u: string; exp: number; sv?: number; r?: "member"; i?: string };

/** Validates a decoded cookie payload; null when malformed or expired. */
export function parseSessionData(raw: unknown, now = Date.now()): SessionData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d["u"] !== "string" || !d["u"]) return null;
  if (typeof d["exp"] !== "number" || d["exp"] < now) return null;
  const sv = d["sv"];
  if (sv !== undefined && !(typeof sv === "number" && Number.isInteger(sv) && sv >= 1)) return null;
  const r = d["r"];
  if (r !== undefined && r !== "member") return null;
  const i = d["i"];
  if (i !== undefined && !(typeof i === "string" && i.length > 0 && i.length <= 64)) return null;
  const out: SessionData = { u: d["u"], exp: d["exp"] };
  if (sv !== undefined) out.sv = sv as number;
  if (r === "member") out.r = "member";
  if (typeof i === "string") out.i = i;
  return out;
}

/**
 * Whether a cookie's `sv` is still current. `current` null = no user row / table missing /
 * lookup failed: behave exactly as before v17 (valid).
 */
export function sessionVersionValid(sv: number | undefined, current: number | null): boolean {
  if (current === null) return true;
  return (sv ?? 1) === current;
}
