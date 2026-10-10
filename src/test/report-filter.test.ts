import { describe, expect, it } from "vitest";
import {
  NO_ACCOUNT,
  TRANSFER_IN,
  TRANSFER_OUT,
  isTransferCategory,
  parseAccountParam,
  reportScope,
  resolveReportAccount,
  validateReportSearch,
  walletAggRows,
} from "../lib/report-filter";
import { flowOf } from "../lib/account-report";
import { sumMonthKind } from "../lib/aggregate";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("validateReportSearch", () => {
  it("keeps a valid uuid (lower-cased) and drops everything else", () => {
    expect(validateReportSearch({ account: A })).toEqual({ account: A });
    expect(validateReportSearch({ account: ` ${A.toUpperCase()} ` })).toEqual({ account: A });
    expect(validateReportSearch({})).toEqual({});
    expect(validateReportSearch({ account: "bogus" })).toEqual({});
    expect(validateReportSearch({ account: 42 })).toEqual({});
    expect(validateReportSearch({ account: NO_ACCOUNT })).toEqual({});
    expect(validateReportSearch({ account: `${A},${B}` })).toEqual({});
    expect(validateReportSearch({ account: A, other: "x" })).toEqual({ account: A });
  });
  it("parseAccountParam rejects PostgREST injection attempts", () => {
    expect(parseAccountParam(`${A}),to_account_id.neq.(x`)).toBeUndefined();
  });
});

describe("resolveReportAccount", () => {
  const accounts = [{ id: A }, { id: B }];
  it("falls back to all wallets for unknown ids", () => {
    expect(resolveReportAccount(A, accounts)).toBe(A);
    expect(resolveReportAccount(C, accounts)).toBeUndefined();
    expect(resolveReportAccount(undefined, accounts)).toBeUndefined();
    expect(resolveReportAccount(A, undefined)).toBeUndefined();
  });
});

describe("reportScope (server intersection, never trusts the client)", () => {
  it("no filter keeps today's behaviour for owner and member", () => {
    expect(reportScope(null, undefined)).toEqual({ scope: null, account: null });
    expect(reportScope(null, "")).toEqual({ scope: null, account: null });
    expect(reportScope([A, B], undefined)).toEqual({ scope: [A, B], account: null });
  });
  it("owner may pick any wallet", () => {
    expect(reportScope(null, C).account).toBe(C);
    expect(reportScope(undefined, A.toUpperCase()).account).toBe(A);
  });
  it("member gets a permitted wallet", () => {
    expect(reportScope([A, B], B)).toEqual({ scope: [A, B], account: B });
  });
  it("member asking outside the scope gets an empty report, not other data", () => {
    expect(reportScope([A, B], C).account).toBe(NO_ACCOUNT);
    expect(reportScope([], A).account).toBe(NO_ACCOUNT);
    expect(reportScope([A], "not-a-uuid").account).toBe(NO_ACCOUNT);
    expect(reportScope(null, "not-a-uuid").account).toBe(NO_ACCOUNT);
  });
});

describe("walletAggRows (transfers count as wallet money in/out)", () => {
  const cat = { name: "Makan", color: "#f00" };
  const rows = [
    {
      kind: "income",
      amount_idr: 1000,
      occurred_at: "2025-01-01",
      category_id: "s",
      category: null,
      account_id: A,
    },
    {
      kind: "expense",
      amount_idr: 200,
      occurred_at: "2025-01-02",
      category_id: "f",
      category: cat,
      account_id: A,
    },
    {
      kind: "expense",
      amount_idr: 999,
      occurred_at: "2025-01-02",
      category_id: "f",
      category: cat,
      account_id: B,
    },
    {
      kind: "transfer",
      amount_idr: 300,
      occurred_at: "2025-01-03",
      account_id: A,
      to_account_id: B,
    },
    {
      kind: "transfer",
      amount_idr: 50,
      occurred_at: "2025-02-03",
      account_id: C,
      to_account_id: A,
    },
    { kind: "transfer", amount_idr: 7, occurred_at: "2025-02-04", account_id: A, to_account_id: A },
  ];
  it("maps rows from the wallet's point of view", () => {
    const out = walletAggRows(rows, A);
    expect(out.map((r) => [r.kind, r.amount_idr, r.category?.name ?? null])).toEqual([
      ["income", 1000, null],
      ["expense", 200, "Makan"],
      ["expense", 300, TRANSFER_OUT],
      ["income", 50, TRANSFER_IN],
      ["expense", 7, TRANSFER_OUT],
    ]);
  });
  it("matches the per-account report flows (flowOf) for IDR wallets", () => {
    for (const id of [A, B, C]) {
      const totals = sumMonthKind(walletAggRows(rows, id));
      const inflow = rows.reduce(
        (a, t) => a + flowOf({ ...t, amount: t.amount_idr }, id).inflow,
        0,
      );
      const outflow = rows.reduce(
        (a, t) => a + flowOf({ ...t, amount: t.amount_idr }, id).outflow,
        0,
      );
      const sum = (k: string) =>
        totals.filter((x) => x.kind === k).reduce((a, x) => a + x.total, 0);
      expect(sum("income")).toBe(inflow);
      expect(sum("expense")).toBe(outflow);
    }
  });
  it("flags the pseudo transfer categories", () => {
    expect(isTransferCategory(TRANSFER_IN)).toBe(true);
    expect(isTransferCategory(TRANSFER_OUT)).toBe(true);
    expect(isTransferCategory("Makan")).toBe(false);
    expect(isTransferCategory(null)).toBe(false);
  });
});
