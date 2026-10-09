import { beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal PostgREST stub: pockets / transactions / accounts reads and pocket_alerts inserts with
// unique (pocket_id, period, level). `missingAlerts` simulates v19 pocket_alerts not created.
const state = {
  pocket: null as any,
  txs: [] as any[],
  alerts: new Set<string>(),
  missingAlerts: false,
};

function query(table: string) {
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    gte: () => q,
    lt: () => q,
    order: () => q,
    range: async () => ({ data: table === "transactions" ? state.txs : [], error: null }),
    maybeSingle: async () => ({ data: table === "pockets" ? state.pocket : null, error: null }),
    then: (res: any) =>
      res({
        data: table === "accounts" ? [{ id: "a1", name: "BCA", currency: "IDR" }] : [],
        error: null,
      }),
    insert: async (r: any) => {
      if (state.missingAlerts)
        return { error: { code: "PGRST205", message: "Could not find the table" } };
      const k = `${r.pocket_id}|${r.period}|${r.level}`;
      if (state.alerts.has(k)) return { error: { code: "23505", message: "duplicate key value" } };
      state.alerts.add(k);
      return { error: null };
    },
  };
  return q;
}

vi.mock("../lib/db.server", () => ({ db: () => ({ from: (t: string) => query(t) }) }));
vi.mock("../lib/finance.server", () => ({
  today: () => "2026-10-20",
  isMissingTable: (e: { code?: string }) => e?.code === "PGRST205",
  logActivity: vi.fn(),
}));
vi.mock("../lib/monitoring.server", () => ({ logError: vi.fn() }));

import { pocketAlertsFor } from "../lib/pockets.server";

const tx = (amount: number, over: any = {}) => ({
  id: `t${amount}`,
  kind: "expense",
  amount,
  account_id: "a1",
  pocket_id: "p1",
  occurred_at: "2026-10-20",
  ...over,
});

beforeEach(() => {
  state.pocket = {
    id: "p1",
    account_id: "a1",
    name: "Makan",
    allocated: 500,
    min_balance: 100,
    period: "monthly",
    archived: false,
  };
  state.txs = [];
  state.alerts.clear();
  state.missingAlerts = false;
});

describe("pocketAlertsFor", () => {
  it("alerts 'low' once per month when crossing the threshold", async () => {
    state.txs = [tx(300), tx(150)];
    const a = await pocketAlertsFor(tx(150));
    expect(a.map((x) => x.level)).toEqual(["low"]);
    expect(a[0]).toMatchObject({ pocket: "Makan", account: "BCA", remaining: 50 });
    expect(await pocketAlertsFor(tx(150))).toEqual([]); // deduped
  });
  it("jumping straight to empty reports only 'empty' and suppresses a later 'low'", async () => {
    state.txs = [tx(600)];
    expect((await pocketAlertsFor(tx(600))).map((x) => x.level)).toEqual(["empty"]);
    expect(state.alerts.has("p1|2026-10|low")).toBe(true);
  });
  it("edits compare against the previous version of the row", async () => {
    state.txs = [tx(450)];
    // the same row grew from 350 to 450: before = 150 (> 100), after = 50 → low
    expect(
      (await pocketAlertsFor(tx(450, { id: "x" }), tx(350, { id: "x" }))).map((x) => x.level),
    ).toEqual(["low"]);
  });
  it("no alert for income, other months, no pocket, archived pockets", async () => {
    state.txs = [tx(450)];
    expect(await pocketAlertsFor(tx(450, { pocket_id: null }))).toEqual([]);
    expect(await pocketAlertsFor(tx(450, { occurred_at: "2026-09-30" }))).toEqual([]);
    state.txs = [tx(450, { kind: "income" })];
    expect(await pocketAlertsFor(tx(450, { kind: "income" }))).toEqual([]);
    state.pocket.archived = true;
    state.txs = [tx(450)];
    expect(await pocketAlertsFor(tx(450))).toEqual([]);
  });
  it("still alerts without dedupe before pocket_alerts exists, never throws", async () => {
    state.missingAlerts = true;
    state.txs = [tx(450)];
    expect(await pocketAlertsFor(tx(450))).toHaveLength(1);
    state.pocket = undefined as any;
    expect(await pocketAlertsFor(tx(450))).toEqual([]);
  });
});
