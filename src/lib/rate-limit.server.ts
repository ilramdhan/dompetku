/**
 * Persistent fixed-window rate limit (v24 `rate_limits` + `dk_rate_hit`, issue #94). Shared by
 * every server instance, unlike the in-memory demo limiter. Pure window/key math in ./rate-limit.ts.
 *
 * - Subjects (IP addresses, share tokens) are never stored raw: `subjectHash()` is HMAC-SHA256 with
 *   a key derived by HKDF from SESSION_SECRET (domain-separated, so it is not the cookie key).
 * - `rateHit()` FAILS CLOSED: a missing table/function, a DB error or a missing secret all return
 *   `false` (refuse), because it guards public writes that must never be unlimited.
 */
import { createHmac, hkdfSync } from "crypto";
import { db } from "./db.server";
import { rateKey, windowStart, withinLimit, type RateRule } from "./rate-limit";

const INFO = "dompetku:rate-limit:v1";

function hashKey(): Buffer | null {
  const s = process.env["SESSION_SECRET"];
  if (!s || s.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", s, "dompetku-rate", INFO, 32));
}

/** HMAC-SHA256 hex of `value` (e.g. "ip:1.2.3.4"), or null without a usable SESSION_SECRET. */
export function subjectHash(value: string): string | null {
  const key = hashKey();
  if (!key) return null;
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/**
 * Counts one hit per rule for `subject` (already hashed) and returns true only when every rule is
 * still within its limit. Any failure → false.
 */
export async function rateHit(
  rules: readonly RateRule[],
  subject: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!subject) return false;
  try {
    const results = await Promise.all(
      rules.map((r) =>
        db().rpc("dk_rate_hit", {
          p_key: rateKey(r, subject),
          p_window: windowStart(now, r.windowMs),
        }),
      ),
    );
    return results.every((res, i) => !res.error && withinLimit(res.data, rules[i]!.limit));
  } catch {
    return false;
  }
}
