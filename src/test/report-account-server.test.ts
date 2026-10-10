/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Reports / Rekap tahunan (issue #62). The inline snapshots below were recorded from the code
 * BEFORE the wallet filter existed, so the "no filter" cases prove old users see identical numbers
 * (both through the v9 SQL fast path and the JS fallback).
 */
const A = "11111111-1111-4111-8111-111111111111"; // BCA
const B = "22222222-2222-4222-8222-222222222222"; // Cash
const C = "33333333-3333-4333-8333-333333333333"; // hidden from the member
const food = { name: "Makan", color: "#f00" };
const fun = { name: "Hiburan", color: "#0f0" };
const salary = { name: "Gaji", color: "#00f" };
const TX: any[] = [
  {
    kind: "income",
    amount_idr: 10_000_000,
    occurred_at: "2025-01-05",
    category_id: "c-sal",
    category: salary,
    account_id: A,
    to_account_id: null,
  },
  {
    kind: "expense",
    amount_idr: 150_000,
    occurred_at: "2025-01-10",
    category_id: "c-food",
    category: food,
    account_id: A,
    to_account_id: null,
  },
  {
    kind: "expense",
    amount_idr: 50_000.5,
    occurred_at: "2025-02-11",
    category_id: "c-food",
    category: food,
    account_id: B,
    to_account_id: null,
  },
  {
    kind: "transfer",
    amount_idr: 1_000_000,
    occurred_at: "2025-02-01",
    category_id: null,
    category: null,
    account_id: A,
    to_account_id: B,
  },
  {
    kind: "expense",
    amount_idr: 300_000,
    occurred_at: "2025-03-03",
    category_id: "c-fun",
    category: fun,
    account_id: C,
    to_account_id: null,
  },
  {
    kind: "transfer",
    amount_idr: 200_000,
    occurred_at: "2025-03-04",
    category_id: null,
    category: null,
    account_id: C,
    to_account_id: A,
  },
  {
    kind: "expense",
    amount_idr: 25_000,
    occurred_at: "2025-03-09",
    category_id: null,
    category: null,
    account_id: A,
    to_account_id: null,
  },
  {
    kind: "income",
    amount_idr: 500_000,
    occurred_at: "2024-12-31",
    category_id: "c-sal",
    category: salary,
    account_id: A,
    to_account_id: null,
  },
];
const ACCOUNTS = [{ id: A }, { id: B }, { id: C }];

const state = { sql: true, rpcCalls: [] as string[] };

function rpcRows(name: string, a: any) {
  const inRange = TX.filter((t) => t.occurred_at >= a.p_start && t.occurred_at < a.p_end);
  const agg = async () => import("../lib/aggregate");
  return agg().then((m) => {
    if (name === "dk_month_totals") return m.sumMonthKind(inRange);
    if (name === "dk_category_totals")
      return m.sumCategories(inRange.filter((t) => t.kind === a.p_kind));
    if (name === "dk_month_category_totals")
      return m.sumMonthCategories(inRange.filter((t) => t.kind === "expense"));
    throw new Error(`unexpected rpc ${name}`);
  });
}

function from(table: string) {
  const filters: ((r: any) => boolean)[] = [];
  let single = false;
  const rows = () => (table === "accounts" ? ACCOUNTS : table === "transactions" ? TX : []);
  const api: any = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
    neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), api),
    lt: (k: string, v: any) => (filters.push((r) => r[k] < v), api),
    gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), api),
    in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), api),
    or: (expr: string) => {
      // supports `a.eq.x,b.eq.y` and `a.in.(x,y),b.in.(x,y)`
      const parts = expr.match(/\w+\.(?:eq\.[^,]+|in\.\([^)]*\))/g) ?? [];
      const tests = parts.map((p) => {
        const [k, op, ...rest] = p.split(".");
        const v = rest.join(".");
        if (op === "eq") return (r: any) => r[k!] === v;
        const list = v.slice(1, -1).split(",");
        return (r: any) => list.includes(r[k!]);
      });
      filters.push((r) => tests.some((f) => f(r)));
      return api;
    },
    range: (a: number, b: number) => ({
      then: (res: any) =>
        res({
          data: rows()
            .filter((r) => filters.every((f) => f(r)))
            .slice(a, b + 1),
          error: null,
        }),
    }),
    maybeSingle: () => ((single = true), api),
    then: (res: any) => {
      const data = rows().filter((r) => filters.every((f) => f(r)));
      return res({ data: single ? (data[0] ?? null) : data, error: null });
    },
  };
  return api;
}

vi.mock("../lib/db.server", () => ({
  db: () => ({
    from,
    rpc: async (name: string, args: any) => {
      state.rpcCalls.push(name);
      if (!state.sql)
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      return { data: await rpcRows(name, args), error: null };
    },
  }),
}));
vi.mock("../lib/app-settings.server", () => ({
  cachedAppSettings: () => ({ timezone: "Asia/Jakarta" }),
  getAppSettings: async () => ({ timezone: "Asia/Jakarta" }),
}));

import { categoryTrend, computeYearly, yearlySummary } from "../lib/finance.server";
import { resetAggregateState } from "../lib/aggregate";
import { reportScope } from "../lib/report-filter";

beforeEach(() => {
  state.sql = true;
  state.rpcCalls = [];
  resetAggregateState();
});

describe("reports without a wallet filter (unchanged for old users)", () => {
  for (const sql of [true, false]) {
    describe(sql ? "SQL path" : "JS fallback", () => {
      beforeEach(() => {
        state.sql = sql;
      });
      it("yearlySummary", async () => {
        const out = await yearlySummary(2025);
        expect(state.rpcCalls).toContain("dk_month_totals");
        expect(out).toMatchInlineSnapshot(`
          {
            "avgExpense": 43750.041666666664,
            "avgIncome": 833333.3333333334,
            "expense": 525000.5,
            "income": 10000000,
            "months": [
              {
                "expense": 150000,
                "income": 10000000,
                "month": "2025-01",
                "net": 9850000,
              },
              {
                "expense": 50000.5,
                "income": 0,
                "month": "2025-02",
                "net": -50000.5,
              },
              {
                "expense": 325000,
                "income": 0,
                "month": "2025-03",
                "net": -325000,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-04",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-05",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-06",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-07",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-08",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-09",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-10",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-11",
                "net": 0,
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-12",
                "net": 0,
              },
            ],
            "net": 9474999.5,
            "year": 2025,
          }
        `);
      });
      it("categoryTrend", async () => {
        const out = await categoryTrend(3, "2025-03");
        expect(state.rpcCalls).toContain("dk_month_category_totals");
        expect(out).toMatchInlineSnapshot(`
          {
            "categories": [
              {
                "color": "#0f0",
                "id": "c-fun",
                "name": "Hiburan",
                "total": 300000,
              },
              {
                "color": "#f00",
                "id": "c-food",
                "name": "Makan",
                "total": 200000.5,
              },
              {
                "color": null,
                "id": "none",
                "name": "Tanpa kategori",
                "total": 25000,
              },
            ],
            "months": [
              "2025-01",
              "2025-02",
              "2025-03",
            ],
            "series": [
              {
                "c-food": 150000,
                "month": "2025-01",
              },
              {
                "c-food": 50000.5,
                "month": "2025-02",
              },
              {
                "c-fun": 300000,
                "month": "2025-03",
                "none": 25000,
              },
            ],
          }
        `);
      });
      it("computeYearly", async () => {
        const out = await computeYearly("2025");
        expect(state.rpcCalls).toContain("dk_month_totals");
        expect(out).toMatchInlineSnapshot(`
          {
            "avgExpense": 43750.041666666664,
            "avgIncome": 833333.3333333334,
            "byCategory": [
              {
                "color": "#0f0",
                "name": "Hiburan",
                "value": 300000,
              },
              {
                "color": "#f00",
                "name": "Makan",
                "value": 200000.5,
              },
              {
                "color": null,
                "name": "Tanpa kategori",
                "value": 25000,
              },
            ],
            "expense": 525000.5,
            "income": 10000000,
            "months": [
              {
                "expense": 150000,
                "income": 10000000,
                "month": "2025-01",
              },
              {
                "expense": 50000.5,
                "income": 0,
                "month": "2025-02",
              },
              {
                "expense": 325000,
                "income": 0,
                "month": "2025-03",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-04",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-05",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-06",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-07",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-08",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-09",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-10",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-11",
              },
              {
                "expense": 0,
                "income": 0,
                "month": "2025-12",
              },
            ],
            "net": 9474999.5,
            "year": "2025",
          }
        `);
      });
    });
  }

  it("member scope (no wallet filter) keeps the JS path", async () => {
    const out = await yearlySummary(2025, [A, B]);
    expect(state.rpcCalls).toEqual([]);
    expect(out.income).toBe(10_000_000);
    expect(out.expense).toBe(225_000.5);
  });
});

describe("reports filtered to one wallet (#62)", () => {
  it("yearlySummary counts the wallet's income/expense plus transfers in/out (JS path)", async () => {
    const out = await yearlySummary(2025, null, A);
    expect(state.rpcCalls).toEqual([]);
    // income 10M + transfer in 200k; expense 150k + 25k + transfer out 1M (2024 row excluded)
    expect(out.income).toBe(10_200_000);
    expect(out.expense).toBe(1_175_000);
    expect(out.months.slice(0, 3).map((m) => [m.income, m.expense])).toEqual([
      [10_000_000, 150_000],
      [0, 1_000_000],
      [200_000, 25_000],
    ]);
  });
  it("categoryTrend groups transfers out as one pseudo category", async () => {
    const out = await categoryTrend(3, "2025-03", null, B);
    expect(out.categories).toEqual([
      { id: "c-food", name: "Makan", color: "#f00", total: 50_000.5 },
    ]);
    const a = await categoryTrend(3, "2025-03", null, A);
    expect(a.categories.map((c) => [c.name, c.total])).toEqual([
      ["Transfer keluar", 1_000_000],
      ["Makan", 150_000],
      ["Tanpa kategori", 25_000],
    ]);
  });
  it("computeYearly by category and totals for one wallet", async () => {
    const out = await computeYearly("2025", C);
    expect(out.income).toBe(0);
    expect(out.expense).toBe(500_000);
    expect(out.byCategory).toEqual([
      { name: "Hiburan", color: "#0f0", value: 300_000 },
      { name: "Transfer keluar", color: null, value: 200_000 },
    ]);
  });
  it("an id outside the member scope yields an empty report (no leak)", async () => {
    const r = reportScope([A, B], C);
    const out = await yearlySummary(2025, r.scope, r.account);
    expect(out.income).toBe(0);
    expect(out.expense).toBe(0);
    const trend = await categoryTrend(3, "2025-03", r.scope, r.account);
    expect(trend.categories).toEqual([]);
  });
  it("a permitted wallet for a member equals the owner's view of it", async () => {
    const r = reportScope([A, B], A);
    expect(await yearlySummary(2025, r.scope, r.account)).toEqual(
      await yearlySummary(2025, null, A),
    );
  });
});
