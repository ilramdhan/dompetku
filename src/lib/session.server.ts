import { createHash, createHmac, timingSafeEqual } from "crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { parseSessionData, sessionVersionValid, type SessionData } from "./session";

const COOKIE = "dk_session";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s || s.length < 32) throw new Error("SESSION_SECRET belum diatur (minimal 32 karakter).");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEq(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Login check: v17 stored hash for the env user when set, else APP_PASSWORD in constant time.
 * See users.server.ts for the precedence and recovery rules.
 */
export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const { checkCredentials: check } = await import("./users.server");
  return check(username, password);
}

const cookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  partitioned: true,
  path: "/",
};

/** Sets the session cookie. `sv` = the user's current session_version (omitted before v17). */
export function createSession(username: string, sv?: number | null): void {
  const data: SessionData = { u: username, exp: Date.now() + MAX_AGE * 1000 };
  if (typeof sv === "number") data.sv = sv;
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  setCookie(COOKIE, `${payload}.${sign(payload)}`, { ...cookieOpts, maxAge: MAX_AGE });
}

/** Signature + expiry check only (no session-version check); prefer readValidSession(). */
export function readSession(): { u: string; sv?: number } | null {
  const raw = getCookie(COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEq(sig, sign(payload))) return null;
  try {
    const data = parseSessionData(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!data) return null;
    return data.sv === undefined ? { u: data.u } : { u: data.u, sv: data.sv };
  } catch {
    return null;
  }
}

/**
 * Signed, unexpired cookie whose `sv` still matches the user's session_version (v17, cached
 * ~45 s). No user row / no table = valid, exactly as before v17.
 */
export async function readValidSession(): Promise<{ u: string; sv?: number } | null> {
  const s = readSession();
  if (!s) return null;
  const { currentSessionVersion } = await import("./users.server");
  return sessionVersionValid(s.sv, await currentSessionVersion(s.u)) ? s : null;
}

/** Session version to embed in a new cookie (null before v17 / without a user row); read fresh. */
export async function sessionVersionFor(username: string): Promise<number | null> {
  const { currentSessionVersion, forgetSessionVersion } = await import("./users.server");
  forgetSessionVersion(username);
  return currentSessionVersion(username);
}

export function destroySession(): void {
  deleteCookie(COOKIE, cookieOpts);
}

// Two-step login: short-lived proof that the password step passed. The HMAC is
// domain-separated so a challenge can never validate as a session cookie.
const CHALLENGE_TTL = 5 * 60_000;
const CHALLENGE_TAG = "totp-challenge.";

export function createLoginChallenge(username: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: now + CHALLENGE_TTL })).toString(
    "base64url",
  );
  return `${payload}.${sign(CHALLENGE_TAG + payload)}`;
}

/** Returns the username when the challenge is authentic and unexpired. */
export function readLoginChallenge(token: string, now = Date.now()): string | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEq(sig, sign(CHALLENGE_TAG + payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u: unknown;
      exp: unknown;
    };
    if (typeof data.u !== "string" || typeof data.exp !== "number" || data.exp < now) return null;
    return data.u;
  } catch {
    return null;
  }
}
