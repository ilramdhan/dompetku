import { describe, expect, it } from "vitest";
import {
  agingBucket,
  agingReport,
  periodSummary,
  validateInvoiceReportSearch,
  type ReportInvoice,
} from "../lib/invoice-report";

describe("agingBucket", () => {
  const today = "2026-10-30";
  it("maps days past due to buckets", () => {
    expect(agingBucket(null, today)).toBe("current");
    expect(agingBucket("2026-11-05", today)).toBe("current");
    expect(agingBucket("2026-10-30", today)).toBe("current");
    expect(agingBucket("2026-10-29", today)).toBe("d1_30");
    expect(agingBucket("2026-09-30", today)).toBe("d1_30"); // 30 days
    expect(agingBucket("2026-09-29", today)).toBe("d31_60"); // 31
    expect(agingBucket("2026-08-31", today)).toBe("d31_60"); // 60
    expect(agingBucket("2026-08-30", today)).toBe("d61_90"); // 61
    expect(agingBucket("2026-07-02", today)).toBe("d90plus");
  });
});

describe("agingReport", () => {
  it("sums outstanding of open invoices only", () => {
    const r = agingReport(
      [
        { status: "unpaid", total: 100, paid: 0, due_date: "2026-11-30" },
        { status: "partial", total: 200, paid: 50, due_date: "2026-10-01" },
        { status: "unpaid", total: 300, paid: 0, due_date: "2026-01-01" },
        { status: "paid", total: 999, paid: 999, due_date: "2026-01-01" },
        { status: "draft", total: 999, paid: 0, due_date: "2026-01-01" },
        { status: "cancelled", total: 999, paid: 0, due_date: null },
      ],
      "2026-10-30",
    );
    expect(r.buckets.map((b) => [b.key, b.count, b.amount])).toEqual([
      ["current", 1, 100],
      ["d1_30", 1, 150],
      ["d31_60", 0, 0],
      ["d61_90", 0, 0],
      ["d90plus", 1, 300],
    ]);
    expect(r.total).toBe(550);
    expect(r.count).toBe(3);
    expect(r.overdue).toBe(450);
    expect(r.overdueCount).toBe(2);
  });
  it("is empty without invoices", () => {
    const r = agingReport([], "2026-10-30");
    expect(r.buckets).toHaveLength(5);
    expect(r.total).toBe(0);
  });
});

describe("periodSummary", () => {
  const inv = (o: Partial<ReportInvoice> & { id: string }): ReportInvoice => ({
    status: "unpaid",
    total: 1000,
    issue_date: "2026-10-05",
    account_id: "a1",
    ...o,
  });
  it("computes issued, received and outstanding as of period end", () => {
    const invoices = [
      inv({ id: "1", total: 1000 }), // issued Oct, paid 400 in Oct and 600 in Nov
      inv({ id: "2", total: 500, issue_date: "2026-09-10", account_id: "a2", status: "partial" }),
      inv({ id: "3", total: 700, status: "draft" }),
      inv({ id: "4", total: 800, status: "cancelled" }),
      inv({ id: "5", total: 900, issue_date: "2026-11-02" }),
    ];
    const payments = [
      { invoice_id: "1", amount: 400, paid_at: "2026-10-20" },
      { invoice_id: "1", amount: 600, paid_at: "2026-11-01" },
      { invoice_id: "2", amount: 100, paid_at: "2026-09-15" },
      { invoice_id: "2", amount: 150, paid_at: "2026-10-31" },
    ];
    const s = periodSummary(invoices, payments, "2026-10");
    expect(s.issued).toBe(1000);
    expect(s.issuedCount).toBe(1);
    expect(s.received).toBe(550);
    expect(s.receivedCount).toBe(2);
    // inv1: 1000-400 = 600 ; inv2: 500-250 = 250
    expect(s.outstanding).toBe(850);
    expect(s.outstandingCount).toBe(2);
    expect(s.byWallet).toEqual([
      { account_id: "a1", issued: 1000, received: 400, outstanding: 600 },
      { account_id: "a2", issued: 0, received: 150, outstanding: 250 },
    ]);
  });
  it("later month sees invoice fully paid", () => {
    const s = periodSummary(
      [inv({ id: "1", status: "paid" })],
      [{ invoice_id: "1", amount: 1000, paid_at: "2026-10-06" }],
      "2026-11",
    );
    expect(s.outstanding).toBe(0);
    expect(s.issued).toBe(0);
    expect(s.byWallet).toEqual([]);
  });
});

describe("validateInvoiceReportSearch", () => {
  it("keeps only valid values", () => {
    expect(validateInvoiceReportSearch({ month: "2026-13", account: "x" })).toEqual({});
    expect(
      validateInvoiceReportSearch({
        month: "2026-10",
        account: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({ month: "2026-10", account: "11111111-1111-4111-8111-111111111111" });
  });
});
