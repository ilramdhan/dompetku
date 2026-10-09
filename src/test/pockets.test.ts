import { describe, expect, it } from "vitest";
import {
  crossedPocketLevels,
  keepPocket,
  matchPocket,
  pocketAlertLines,
  pocketDelta,
  pocketLevel,
  pocketOnEdit,
  pocketsText,
  pocketStatus,
  pocketToSave,
  selectablePockets,
  splitPocketTag,
  unallocated,
  type Pocket,
  type PocketTx,
} from "@/lib/pockets";
import { classifyBotCommand, previewText } from "@/lib/bot";
import { maskTx } from "@/lib/permissions";
import { RESTORE_TABLES, applyRemap, NATURAL_KEYS } from "@/lib/backup";
import { activityLabel } from "@/lib/activity";
import { pocketSchema, transactionSchema } from "@/lib/schemas";

const makan: Pocket = {
  id: "p1",
  account_id: "a1",
  name: "Makan",
  allocated: 500_000,
  min_balance: 100_000,
  period: "monthly",
};
const tx = (over: Partial<PocketTx>): PocketTx => ({
  kind: "expense",
  amount: 0,
  account_id: "a1",
  pocket_id: "p1",
  occurred_at: "2026-10-15",
  ...over,
});

describe("pocketStatus (monthly envelope)", () => {
  it("remaining = allocated − expenses + incomes of the month", () => {
    const s = pocketStatus(
      makan,
      [
        tx({ amount: 150_000 }),
        tx({ amount: 50_000, kind: "transfer" }),
        tx({ amount: 20_000, kind: "income" }),
      ],
      "2026-10",
    );
    expect(s).toMatchObject({ spent: 200_000, added: 20_000, remaining: 320_000, level: null });
    expect(s.percentLeft).toBe(64);
  });
  it("respects month boundaries (first day in, first day of next month out)", () => {
    const rows = [
      tx({ amount: 100, occurred_at: "2026-10-01" }),
      tx({ amount: 1000, occurred_at: "2026-09-30" }),
      tx({ amount: 10_000, occurred_at: "2026-11-01" }),
      tx({ amount: 7, occurred_at: "2026-10-31T23:59:00+07:00" }),
    ];
    expect(pocketStatus(makan, rows, "2026-10").spent).toBe(107);
    expect(pocketStatus(makan, rows, "2026-09").spent).toBe(1000);
  });
  it("running envelope ('none') counts every month", () => {
    const run = { ...makan, period: "none" };
    const rows = [tx({ amount: 100, occurred_at: "2025-01-01" }), tx({ amount: 50 })];
    expect(pocketStatus(run, rows, "2026-10").remaining).toBe(499_850);
  });
  it("ignores other pockets and rows on another wallet", () => {
    const s = pocketStatus(
      makan,
      [tx({ amount: 1, pocket_id: "p2" }), tx({ amount: 9, account_id: "a2" })],
      "2026-10",
    );
    expect(s.remaining).toBe(500_000);
  });
  it("flags low and empty, empty wins", () => {
    expect(pocketStatus(makan, [tx({ amount: 400_000 })], "2026-10").level).toBe("low");
    expect(pocketStatus(makan, [tx({ amount: 600_000 })], "2026-10")).toMatchObject({
      level: "empty",
      remaining: -100_000,
      percentLeft: 0,
    });
    expect(pocketLevel(50, null)).toBeNull();
    expect(pocketLevel(0, null)).toBe("empty");
  });
  it("pocketDelta: receiving side of a transfer never counts", () => {
    expect(pocketDelta(tx({ amount: 5, kind: "transfer", account_id: "a2" }), "a1")).toBe(0);
    expect(pocketDelta(tx({ amount: "5" }), "a1")).toBe(-5);
  });
});

describe("unallocated", () => {
  it("balance minus positive remaining of active pockets", () => {
    expect(
      unallocated(1_000_000, [
        { remaining: 300_000 },
        { remaining: -50 },
        { remaining: 9, archived: true },
      ]),
    ).toEqual({ amount: 700_000, earmarked: 300_000, over: false });
  });
  it("goes negative when over-allocated", () => {
    expect(unallocated(100, [{ remaining: 150 }])).toEqual({
      amount: -50,
      earmarked: 150,
      over: true,
    });
  });
});

describe("crossedPocketLevels", () => {
  it("fires low once when crossing the threshold downward", () => {
    expect(crossedPocketLevels(150, 90, 100)).toEqual({ report: ["low"], claim: ["low"] });
    expect(crossedPocketLevels(90, 80, 100).claim).toEqual([]);
    expect(crossedPocketLevels(90, 150, 100).claim).toEqual([]);
  });
  it("reports only empty when jumping past both levels, but claims both", () => {
    expect(crossedPocketLevels(500, -1, 100)).toEqual({
      report: ["empty"],
      claim: ["empty", "low"],
    });
  });
  it("without a threshold only empty exists", () => {
    expect(crossedPocketLevels(10, 0, null)).toEqual({ report: ["empty"], claim: ["empty"] });
    expect(crossedPocketLevels(0, -5, null).claim).toEqual([]);
  });
});

describe("form helpers", () => {
  const list: Pocket[] = [
    makan,
    { id: "p2", account_id: "a1", name: "Transport", allocated: 1, sort_order: -1 },
    { id: "p3", account_id: "a1", name: "Lama", allocated: 1, archived: true },
    { id: "p4", account_id: "a2", name: "Parkir", allocated: 1 },
  ];
  it("lists active pockets of the chosen wallet, sorted", () => {
    expect(selectablePockets(list, "a1", "expense").map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(selectablePockets(list, null, "expense")).toEqual([]);
    expect(selectablePockets(list, "a1", "weird")).toEqual([]);
  });
  it("clears the pocket when the account changes", () => {
    expect(keepPocket("p1", list, "a1", "expense")).toBe("p1");
    expect(keepPocket("p1", list, "a2", "expense")).toBeNull();
    expect(keepPocket("p3", list, "a1", "expense")).toBeNull();
    expect(keepPocket("", list, "a1", "expense")).toBeNull();
  });
  it("pocketToSave keeps an archived pocket already on the row, else validates", () => {
    const init = { pocket_id: "p3", account_id: "a1" };
    expect(pocketToSave({ pocket_id: "p3", account_id: "a1", kind: "expense" }, init, list)).toBe(
      "p3",
    );
    expect(
      pocketToSave({ pocket_id: "p3", account_id: "a2", kind: "expense" }, init, list),
    ).toBeNull();
    // pockets not loaded: untouched unless explicitly cleared
    expect(pocketToSave({ account_id: "a1", kind: "expense" }, {}, [])).toBeUndefined();
    expect(pocketToSave({ pocket_id: null, kind: "expense" }, {}, [])).toBeNull();
    expect(
      pocketToSave(
        { pocket_id: "p1", account_id: "a2", kind: "expense" },
        { pocket_id: "p1", account_id: "a1" },
        [],
      ),
    ).toBeNull();
  });
  it("pocketOnEdit drops the old pocket when the wallet changes", () => {
    expect(pocketOnEdit({ account_id: "a1", pocket_id: "p1" }, { account_id: "a2" })).toBeNull();
    expect(
      pocketOnEdit({ account_id: "a1", pocket_id: "p1" }, { account_id: "a1" }),
    ).toBeUndefined();
    expect(pocketOnEdit(null, { account_id: "a1", pocket_id: "p1" })).toBe("p1");
    expect(pocketOnEdit(null, { account_id: "a1" })).toBeUndefined();
  });
  it("schemas: pocket_id is optional and validated, pocket input is coerced", () => {
    const base = { kind: "expense", amount: 1, occurred_at: "2026-10-01" };
    expect("pocket_id" in transactionSchema.parse(base)).toBe(false);
    expect(transactionSchema.parse({ ...base, pocket_id: "" }).pocket_id).toBeNull();
    expect(() => transactionSchema.parse({ ...base, pocket_id: "x" })).toThrow();
    expect(
      pocketSchema.parse({ name: " Makan ", allocated: "500000", min_balance: "" }),
    ).toMatchObject({
      name: "Makan",
      allocated: 500000,
      min_balance: null,
      period: "monthly",
    });
    expect(() => pocketSchema.parse({ name: "x", allocated: -1 })).toThrow();
  });
});

describe("bot", () => {
  it("splits a trailing #tag", () => {
    expect(splitPocketTag("kopi 25rb #makan")).toEqual({ text: "kopi 25rb", pocket: "makan" });
    expect(splitPocketTag("parkir 5rb pakai cash #uang_parkir")).toEqual({
      text: "parkir 5rb pakai cash",
      pocket: "uang parkir",
    });
    expect(splitPocketTag("kopi 25rb")).toEqual({ text: "kopi 25rb", pocket: null });
    expect(splitPocketTag("#makan")).toEqual({ text: "#makan", pocket: null });
    expect(splitPocketTag("beli #2 kopi 25rb")).toEqual({
      text: "beli #2 kopi 25rb",
      pocket: null,
    });
    expect(splitPocketTag("kaos no #2")).toEqual({ text: "kaos no #2", pocket: null });
  });
  it("matches pockets exact, then prefix, then contains (active only)", () => {
    const list: Pocket[] = [
      { id: "1", account_id: "a", name: "Makan Siang", allocated: 0 },
      { id: "2", account_id: "a", name: "Makan", allocated: 0 },
      { id: "3", account_id: "a", name: "Uang Parkir", allocated: 0 },
      { id: "4", account_id: "a", name: "Arsip", allocated: 0, archived: true },
    ];
    expect(matchPocket(list, "makan")?.id).toBe("2");
    expect(matchPocket(list, "makan si")?.id).toBe("1");
    expect(matchPocket(list, "parkir")?.id).toBe("3");
    expect(matchPocket(list, "arsip")).toBeNull();
    expect(matchPocket(list, null)).toBeNull();
  });
  it("/kantong command, preview line and alert text", () => {
    expect(classifyBotCommand("/kantong")).toEqual({ type: "pockets" });
    expect(classifyBotCommand("kopi 25rb #makan").type).toBe("unknown");
    const preview = previewText(
      {
        kind: "expense",
        amount: 25000,
        currency: "IDR",
        category: "Makan",
        account: "BCA",
        description: "kopi",
        merchant: null,
        date: "2026-10-01",
        items: [],
        via: "quick",
        pocket: "makan",
      },
      null,
    );
    expect(preview).toContain("Kantong: #makan");
    const lines = pocketAlertLines([
      {
        pocket_id: "p1",
        pocket: "Makan",
        account: "BCA",
        currency: "IDR",
        level: "empty",
        remaining: 0,
        allocated: 500000,
        min_balance: null,
      },
    ]);
    expect(lines).toContain("🔴 Kantong Makan (BCA) habis");
    expect(pocketAlertLines([])).toBe("");
  });
  it("pocketsText lists wallets with pockets and the unallocated figure", () => {
    const st = pocketStatus(makan, [tx({ amount: 450_000 })], "2026-10");
    const text = pocketsText(
      [
        { name: "BCA", currency: "IDR", balance: 40_000, pockets: [{ ...makan, ...st }] },
        { name: "Cash", currency: "IDR", balance: 1, pockets: [] },
      ],
      "2026-10",
    );
    expect(text).toContain("🏦 BCA");
    expect(text).toContain("Makan 🟠");
    expect(text).toContain("alokasi melebihi saldo");
    expect(text).not.toContain("Cash");
    expect(pocketsText([], "2026-10")).toContain("Belum ada kantong");
  });
});

describe("integration points", () => {
  it("maskTx hides the pocket of a hidden source wallet", () => {
    const member = { role: "member" as const, grants: { a2: "view" as const } };
    const row = { kind: "transfer", account_id: "a1", to_account_id: "a2", pocket_id: "p1" };
    expect(maskTx(member, row).pocket_id).toBeNull();
    expect(maskTx(member, { ...row, account_id: "a2" }).pocket_id).toBe("p1");
  });
  it("restore order: accounts → pockets → transactions; pocket_alerts after pockets", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    expect(i("accounts")).toBeLessThan(i("pockets"));
    expect(i("pockets")).toBeLessThan(i("transactions"));
    expect(i("pockets")).toBeLessThan(i("pocket_alerts"));
    expect(NATURAL_KEYS.pockets).toEqual(["account_id", "name"]);
    expect(
      applyRemap("transactions", [{ id: "t", pocket_id: "old" }], { pockets: { old: "new" } }),
    ).toEqual([{ id: "t", pocket_id: "new" }]);
  });
  it("activity labels", () => {
    expect(activityLabel("pockets.create")).toBe("Kantong ditambahkan");
    expect(activityLabel("pockets.delete")).toBe("Kantong dihapus");
  });
});
