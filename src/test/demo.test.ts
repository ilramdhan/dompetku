import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientIp,
  createRateLimiter,
  DEMO_CAP_REACHED,
  DEMO_DISABLED,
  demoCapFor,
  demoInfoFrom,
  isDemoEnv,
  isDemoWrite,
  isOverDemoCap,
} from "@/lib/demo";
import { DEFAULT_BRANDING, resolveSettings, brandingOf } from "@/lib/app-settings";

const count = vi.hoisted(() => ({ value: 0 as number | null, calls: 0 }));
vi.mock("@/lib/db.server", () => ({
  db: () => ({
    from: () => ({
      select: async () => {
        count.calls++;
        return { count: count.value, error: null };
      },
    }),
  }),
}));

const ENV_KEYS = ["DEMO_MODE", "APP_USERNAME", "APP_PASSWORD"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  count.value = 0;
  count.calls = 0;
});

describe("demo flag", () => {
  it("is on only for the exact string true", () => {
    expect(isDemoEnv({})).toBe(false);
    expect(isDemoEnv({ DEMO_MODE: "1" })).toBe(false);
    expect(isDemoEnv({ DEMO_MODE: "TRUE" })).toBe(false);
    expect(isDemoEnv({ DEMO_MODE: "true" })).toBe(true);
  });
  it("never leaks credentials when off", () => {
    const info = demoInfoFrom({ APP_USERNAME: "me", APP_PASSWORD: "secret" });
    expect(info).toEqual({ demo: false });
    expect(JSON.stringify(info)).not.toContain("secret");
  });
  it("exposes the demo login when on", () => {
    expect(demoInfoFrom({ DEMO_MODE: "true", APP_USERNAME: "demo", APP_PASSWORD: "pw" })).toEqual({
      demo: true,
      username: "demo",
      password: "pw",
    });
  });
});

describe("caps and write detection", () => {
  it("caps transactions at 3000 and other tables at 200", () => {
    expect(demoCapFor("transactions")).toBe(3000);
    expect(demoCapFor("goals")).toBe(200);
    expect(isOverDemoCap("goals", 199)).toBe(false);
    expect(isOverDemoCap("goals", 200)).toBe(true);
    expect(isOverDemoCap("transactions", null)).toBe(false);
  });
  it("counts only server-function POSTs as writes", () => {
    expect(isDemoWrite("POST", "serverFn")).toBe(true);
    expect(isDemoWrite("get", "serverFn")).toBe(false);
    expect(isDemoWrite("POST", "router")).toBe(false);
  });
  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per key inside a sliding window", () => {
    const rl = createRateLimiter(3, 1000);
    expect([rl.hit("a", 0), rl.hit("a", 10), rl.hit("a", 20)]).toEqual([true, true, true]);
    expect(rl.hit("a", 30)).toBe(false);
    expect(rl.hit("b", 30)).toBe(true);
    expect(rl.hit("a", 1001)).toBe(true); // first hit slid out
    expect(rl.hit("a", 1002)).toBe(false);
  });
  it("bounds memory by evicting the oldest keys", () => {
    const rl = createRateLimiter(1, 1000, 2);
    rl.hit("a", 0);
    rl.hit("b", 0);
    rl.hit("c", 0);
    expect(rl.size()).toBe(2);
  });
});

describe("server guards", () => {
  it("are no-ops when DEMO_MODE is not set", async () => {
    delete process.env["DEMO_MODE"];
    const g = await import("@/lib/demo.server");
    expect(g.isDemo()).toBe(false);
    expect(() => g.assertNotDemo()).not.toThrow();
    count.value = 99_999;
    await expect(g.assertDemoCapacity("transactions")).resolves.toBeUndefined();
    expect(count.calls).toBe(0);
    const req = new Request("https://x/_serverFn/abc", { method: "POST" });
    for (let i = 0; i < 300; i++) expect(g.demoRateLimit(req, "serverFn")).toBeNull();
    expect(g.demoInfo()).toEqual({ demo: false });
  });
  it("refuse disabled features and full tables in demo mode", async () => {
    process.env["DEMO_MODE"] = "true";
    const g = await import("@/lib/demo.server");
    expect(() => g.assertNotDemo()).toThrow(DEMO_DISABLED);
    count.value = 10;
    await expect(g.assertDemoCapacity("goals")).resolves.toBeUndefined();
    count.value = 200;
    await expect(g.assertDemoCapacity("goals")).rejects.toThrow(DEMO_CAP_REACHED);
    await expect(g.assertDemoCapacity("transactions")).resolves.toBeUndefined();
  });
  it("rate-limits writes per IP but never reads", async () => {
    process.env["DEMO_MODE"] = "true";
    const g = await import("@/lib/demo.server");
    const post = new Request("https://x/_serverFn/abc", {
      method: "POST",
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    const get = new Request("https://x/_serverFn/abc", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    let limited: Response | null = null;
    for (let i = 0; i < 121 && !limited; i++) limited = g.demoRateLimit(post, "serverFn");
    expect(limited?.status).toBe(429);
    expect(g.demoRateLimit(get, "serverFn")).toBeNull();
    expect(g.demoRateLimit(post, "router")).toBeNull();
  });
  it("blocks n8n routes with a 403 in demo mode", async () => {
    process.env["DEMO_MODE"] = "true";
    const { checkApiKey } = await import("@/lib/api-key.server");
    const res = await checkApiKey(new Request("https://x/api/public/n8n/summary"));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ ok: false, error: "demo" });
  });
});

describe("PUBLIC_DEMO_URL branding", () => {
  it("is hidden unless an https URL is configured", () => {
    expect(DEFAULT_BRANDING.demo_url).toBeNull();
    expect(brandingOf(resolveSettings(null, { PUBLIC_DEMO_URL: "http://x.test" })).demo_url).toBe(
      null,
    );
    expect(
      brandingOf(resolveSettings(null, { PUBLIC_DEMO_URL: " https://demo.example.com " })).demo_url,
    ).toBe("https://demo.example.com");
  });
});
