import { beforeEach, describe, expect, it, vi } from "vitest";

/* Review L3 (#124): a non-empty MIDTRANS_FEES that fails to parse is logged once, never silently. */
const logged: { scope: string; msg: string }[] = [];
vi.mock("../lib/monitoring.server", () => ({
  logError: (scope: string, e: unknown) =>
    logged.push({ scope, msg: e instanceof Error ? e.message : String(e) }),
}));

import { feeRules } from "@/lib/gateway/midtrans.server";

beforeEach(() => {
  logged.length = 0;
});

describe("MIDTRANS_FEES config logging", () => {
  it("logs an invalid non-empty schedule once per distinct value, without the value", () => {
    expect(feeRules("qris=0,7%")).toBeNull();
    expect(feeRules("qris=0,7%")).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]!.scope).toBe("gateway:mdr-config");
    expect(logged[0]!.msg).not.toContain("0,7");
    expect(feeRules("qris=lots")).toBeNull();
    expect(logged).toHaveLength(2);
  });

  it("stays quiet for empty or valid schedules", () => {
    expect(feeRules("")).toBeNull();
    expect(feeRules(undefined)).toBeNull();
    expect(feeRules("qris=0.7%")).toEqual({ qris: { percent: 0.7, flat: 0 } });
    expect(logged).toEqual([]);
  });
});
