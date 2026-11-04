/**
 * Public demo mode (DEMO_MODE=true) — pure, client-safe helpers.
 *
 * A demo instance is a separate deployment with its own throwaway database. It publishes its
 * login credentials, so every guard here exists to keep that instance cheap and abuse-resistant.
 * With DEMO_MODE unset every helper is a no-op and the app behaves exactly as before.
 */

/** Error for features switched off in demo mode (also an i18n dictionary key). */
export const DEMO_DISABLED = "Tidak tersedia di mode demo";
/** Error once a table reaches its demo row cap (also an i18n dictionary key). */
export const DEMO_CAP_REACHED = "Batas data demo tercapai, coba lagi setelah reset";
/** Error from the per-IP write rate limit (also an i18n dictionary key). */
export const DEMO_RATE_LIMITED = "Terlalu banyak permintaan di mode demo, coba lagi sebentar lagi";

/** Row caps per table while in demo mode; tables not listed use DEMO_DEFAULT_CAP. */
export const DEMO_CAPS: Readonly<Record<string, number>> = { transactions: 3000 };
export const DEMO_DEFAULT_CAP = 200;

/** Write rate limit per IP: 120 POST server-function calls per sliding 10 minutes. */
export const DEMO_RATE_LIMIT = 120;
export const DEMO_RATE_WINDOW_MS = 10 * 60_000;

export type DemoEnv = {
  DEMO_MODE?: string | undefined;
  APP_USERNAME?: string | undefined;
  APP_PASSWORD?: string | undefined;
};

export type DemoInfo = { demo: false } | { demo: true; username: string; password: string };

export function isDemoEnv(env: DemoEnv): boolean {
  return env.DEMO_MODE === "true";
}

/** What the public `getDemoInfo` returns. Credentials are exposed ONLY in demo mode. */
export function demoInfoFrom(env: DemoEnv): DemoInfo {
  if (!isDemoEnv(env)) return { demo: false };
  return { demo: true, username: env.APP_USERNAME ?? "", password: env.APP_PASSWORD ?? "" };
}

export function demoCapFor(table: string): number {
  return DEMO_CAPS[table] ?? DEMO_DEFAULT_CAP;
}

/** True when adding one more row to `table` would exceed its demo cap. */
export function isOverDemoCap(table: string, count: number | null | undefined): boolean {
  return (count ?? 0) >= demoCapFor(table);
}

/** Only server-function POSTs count as writes; GET server fns and page loads are unlimited. */
export function isDemoWrite(method: string, handlerType: string): boolean {
  return handlerType === "serverFn" && method.toUpperCase() === "POST";
}

/**
 * In-memory sliding-window rate limiter. State lives in one server instance only, so on
 * serverless platforms each warm instance counts separately — a soft limit, not a hard quota.
 */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a hit; returns false when `key` is already at the limit (the hit is not recorded). */
    hit(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Bound memory: drop the least recently used keys.
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return true;
    },
    size: () => hits.size,
  };
}
