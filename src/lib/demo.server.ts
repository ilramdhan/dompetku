/**
 * Server-side demo guards. Every export is a no-op unless DEMO_MODE=true, so the private
 * instance (which never sets it) is unaffected.
 */
import { requestIp } from "./client-ip.server";
import {
  createRateLimiter,
  DEMO_CAP_REACHED,
  DEMO_DISABLED,
  DEMO_RATE_LIMIT,
  DEMO_RATE_LIMITED,
  DEMO_RATE_WINDOW_MS,
  demoInfoFrom,
  isDemoEnv,
  isDemoWrite,
  isOverDemoCap,
  type DemoInfo,
} from "./demo";

export function isDemo(): boolean {
  return isDemoEnv({ DEMO_MODE: process.env["DEMO_MODE"] });
}

export function demoInfo(): DemoInfo {
  return demoInfoFrom({
    DEMO_MODE: process.env["DEMO_MODE"],
    APP_USERNAME: process.env["APP_USERNAME"],
    APP_PASSWORD: process.env["APP_PASSWORD"],
  });
}

/** Throws the translated "not available in demo" error when in demo mode. */
export function assertNotDemo(): void {
  if (isDemo()) throw new Error(DEMO_DISABLED);
}

/**
 * Refuses a new row once `table` reaches its demo cap (one cheap head-only count).
 * A failed count never blocks the write.
 */
export async function assertDemoCapacity(table: string): Promise<void> {
  if (!isDemo()) return;
  const { db } = await import("./db.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db() as any).from(table).select("id", { count: "exact", head: true });
  if (res.error) return;
  if (isOverDemoCap(table, res.count)) throw new Error(DEMO_CAP_REACHED);
}

const limiter = createRateLimiter(DEMO_RATE_LIMIT, DEMO_RATE_WINDOW_MS);

/** Request-middleware hook: a 429 text Response when the caller's IP exceeds the write limit. */
export function demoRateLimit(request: Request, handlerType: string): Response | null {
  if (!isDemo() || !isDemoWrite(request.method, handlerType)) return null;
  if (limiter.hit(requestIp(request))) return null;
  return new Response(DEMO_RATE_LIMITED, {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "60",
      "cache-control": "no-store",
    },
  });
}
