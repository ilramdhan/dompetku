import { describe, expect, it } from "vitest";
import { subMonthly, subNextDue } from "@/lib/subscriptions";

describe("subscription intervals", () => {
  it("monthly x3", () => {
    expect(subNextDue("2026-01-15", "monthly", 3)).toBe("2026-04-15");
    expect(subMonthly(300000, "monthly", 3)).toBe(100000);
  });

  it("yearly x5", () => {
    expect(subNextDue("2024-02-29", "yearly", 5)).toBe("2029-02-28");
    expect(subMonthly(1200000, "yearly", 5)).toBe(20000);
  });

  it("missing or invalid interval counts as 1", () => {
    expect(subNextDue("2026-01-15", "monthly", undefined)).toBe("2026-02-15");
    expect(subMonthly(120, "yearly", 0)).toBe(10);
  });
});
