import { describe, it, expect } from "vitest";
import { subMonthly, subMonths, subNextDue } from "@/lib/subscriptions";

describe("subscriptions", () => {
  describe("subMonthly", () => {
    it("monthly interval 1 = unchanged", () => {
      expect(subMonthly(100, "monthly", 1)).toBe(100);
    });

    it("monthly interval 3 = divide by 3", () => {
      expect(subMonthly(300, "monthly", 3)).toBe(100);
    });

    it("yearly interval 1 = divide by 12", () => {
      expect(subMonthly(1200, "yearly", 1)).toBe(100);
    });

    it("yearly interval 2 = divide by 24", () => {
      expect(subMonthly(2400, "yearly", 2)).toBe(100);
    });
  });

  describe("subMonths", () => {
    it("monthly interval 1 = 1 month", () => {
      expect(subMonths("monthly", 1)).toBe(1);
    });

    it("monthly interval 3 = 3 months", () => {
      expect(subMonths("monthly", 3)).toBe(3);
    });

    it("yearly interval 1 = 12 months", () => {
      expect(subMonths("yearly", 1)).toBe(12);
    });

    it("yearly interval 2 = 24 months", () => {
      expect(subMonths("yearly", 2)).toBe(24);
    });
  });

  describe("subNextDue", () => {
    it("monthly +1", () => {
      expect(subNextDue("monthly", 1, "2024-01-15")).toBe("2024-02-15");
    });

    it("monthly +3", () => {
      expect(subNextDue("monthly", 3, "2024-01-15")).toBe("2024-04-15");
    });

    it("yearly +1", () => {
      expect(subNextDue("yearly", 1, "2024-01-15")).toBe("2025-01-15");
    });

    it("yearly +2", () => {
      expect(subNextDue("yearly", 2, "2024-01-15")).toBe("2026-01-15");
    });

    it("handles month overflow (Jan 31 + 1 month)", () => {
      expect(subNextDue("monthly", 1, "2024-01-31")).toBe("2024-02-29"); // leap year
    });
  });
});
