/**
 * Pure, client-safe math for the persistent fixed-window rate limit (v24 `rate_limits`, issue
 * #94). The server (rate-limit.server.ts) turns a rule + subject into a key and a window start,
 * then atomically increments one row per (key, window_start) in Postgres (`dk_rate_hit`). Every
 * instance shares that counter, unlike the in-memory demo limiter in demo.ts.
 * Unit-tested in src/test/invoice-payments.test.ts.
 */

export type RateRule = {
  /** Stable name, part of the key (e.g. "proof:ip"). */
  name: string;
  /** Max hits per window (inclusive). */
  limit: number;
  windowMs: number;
};

const HOUR = 3_600_000;

/**
 * Public proof uploads: per share token and per IP hash (both hashed with a server secret).
 * An hourly burst limit plus a daily cap per IP.
 */
export const PROOF_RATE_RULES = {
  token: [{ name: "proof:token", limit: 10, windowMs: HOUR }],
  ip: [
    { name: "proof:ip", limit: 10, windowMs: HOUR },
    { name: "proof:ip:day", limit: 30, windowMs: 24 * HOUR },
  ],
} as const satisfies Record<string, readonly RateRule[]>;

/**
 * v25 (#97) "Bayar sekarang": creating a Midtrans order per share token and per IP. Pending orders
 * are reused, so legitimate customers need only a few hits.
 */
export const GATEWAY_RATE_RULES = {
  token: [{ name: "pay:token", limit: 20, windowMs: HOUR }],
  ip: [
    { name: "pay:ip", limit: 20, windowMs: HOUR },
    { name: "pay:ip:day", limit: 60, windowMs: 24 * HOUR },
  ],
} as const satisfies Record<string, readonly RateRule[]>;

/** Start of the fixed window containing `nowMs` (ISO string, aligned to the epoch). */
export function windowStart(nowMs: number, windowMs: number): string {
  const w = Math.max(1000, Math.floor(windowMs));
  return new Date(Math.floor(nowMs / w) * w).toISOString();
}

/** Seconds until the current window ends (for Retry-After style messages). */
export function retryAfterSeconds(nowMs: number, windowMs: number): number {
  const w = Math.max(1000, Math.floor(windowMs));
  return Math.max(1, Math.ceil((w - (nowMs % w)) / 1000));
}

/** `<rule name>:<subject>`; subject is already a hash, anything else is stripped. */
export function rateKey(rule: Pick<RateRule, "name">, subject: string): string {
  const s = String(subject ?? "")
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "")
    .slice(0, 64);
  return `${rule.name}:${s || "none"}`;
}

/** True when a hit that brought the window counter to `count` is still allowed. */
export function withinLimit(count: number | null | undefined, limit: number): boolean {
  const n = Number(count);
  return Number.isFinite(n) && n >= 1 && n <= limit;
}
