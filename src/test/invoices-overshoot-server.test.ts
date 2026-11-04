/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Review I9 (#124): the overshoot re-check fails closed when the payments cannot be read. */
let reads: { data: any; error: any }[] = [];
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: () => {
      const api: any = {
        select: () => api,
        eq: () => api,
        then: (res: (v: any) => void) => res(reads.shift() ?? { data: [], error: null }),
      };
      return api;
    },
  }),
}));

import { OVERSHOOT_RECHECK_MS, overshoots } from "@/lib/invoices.server";

const pay = (id: string, amount: number, s: string) => ({
  id,
  amount,
  refunded: 0,
  created_at: `2026-11-01T10:00:${s}Z`,
});
const inv = { id: "inv", total: 100000 } as any;

beforeEach(() => {
  reads = [];
  vi.useRealTimers();
});

describe("bookPayment overshoot re-check", () => {
  it("rolls back when the first re-read fails (fail closed)", async () => {
    reads = [{ data: null, error: { message: "boom" } }];
    expect(await overshoots(inv, "a")).toBe(true);
  });

  it("keeps a payment that fits and rolls back the later of a racing pair", async () => {
    reads = [{ data: [pay("a", 100000, "01")], error: null }];
    expect(await overshoots(inv, "a")).toBe(false);
    reads = [{ data: [pay("a", 60000, "01"), pay("b", 60000, "02")], error: null }];
    expect(await overshoots(inv, "b")).toBe(true);
  });

  it("the earlier payment rechecks: kept once the later rolled back, rolled back on a read error", async () => {
    vi.useFakeTimers();
    const both = { data: [pay("a", 60000, "01"), pay("b", 60000, "02")], error: null };
    reads = [both, { data: [pay("a", 60000, "01")], error: null }];
    let p = overshoots(inv, "a");
    await vi.advanceTimersByTimeAsync(OVERSHOOT_RECHECK_MS);
    expect(await p).toBe(false);
    reads = [both, { data: null, error: { message: "boom" } }];
    p = overshoots(inv, "a");
    await vi.advanceTimersByTimeAsync(OVERSHOOT_RECHECK_MS);
    expect(await p).toBe(true);
  });
});
