import { describe, expect, it } from "vitest";
import {
  ADMIN_ACCESS,
  allowedAccountIds,
  can,
  canOpenPath,
  canViewTx,
  canWriteTx,
  grantsFromRows,
  manageableAccountIds,
  maskTx,
  NIL_UUID,
  OTHER_WALLET,
  routeModule,
  scopeIds,
  txScopeFilter,
  walletLabel,
  walletNetByMonth,
  type Access,
} from "@/lib/permissions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const member: Access = { role: "member", grants: { [A]: "manage", [B]: "view" } };

describe("can()", () => {
  it("gives admins everything", () => {
    expect(can(ADMIN_ACCESS, "wallet:manage", C)).toBe(true);
    expect(can(ADMIN_ACCESS, "module:users")).toBe(true);
  });
  it("resolves wallet levels for members", () => {
    expect(can(member, "wallet:view", A)).toBe(true);
    expect(can(member, "wallet:manage", A)).toBe(true);
    expect(can(member, "wallet:view", B)).toBe(true);
    expect(can(member, "wallet:manage", B)).toBe(false);
    expect(can(member, "wallet:view", C)).toBe(false);
    expect(can(member, "wallet:view", null)).toBe(false);
    // Prototype keys are never grants.
    expect(can(member, "wallet:view", "constructor")).toBe(false);
  });
  it("limits members to their modules and fails closed", () => {
    expect(can(member, "module:dashboard")).toBe(true);
    expect(can(member, "module:reports")).toBe(true);
    expect(can(member, "module:gold")).toBe(false);
    expect(can(member, "module:users")).toBe(false);
    expect(can(null, "module:dashboard")).toBe(false);
    expect(can({ role: "guest" as never, grants: {} }, "module:dashboard")).toBe(false);
  });
});

describe("scoping helpers", () => {
  it("returns null (all) for admins and sorted ids for members", () => {
    expect(allowedAccountIds(ADMIN_ACCESS)).toBeNull();
    expect(allowedAccountIds(member)).toEqual([A, B]);
    expect(manageableAccountIds(member)).toEqual([A]);
    expect(allowedAccountIds(null)).toEqual([]);
  });
  it("never builds an empty or injectable id list", () => {
    expect(scopeIds([])).toEqual([NIL_UUID]);
    expect(scopeIds([A, "x),kind.eq.income"])).toEqual([A]);
    expect(txScopeFilter([A])).toBe(`account_id.in.(${A}),to_account_id.in.(${A})`);
  });
  it("parses grant rows (manage wins, junk dropped)", () => {
    expect(
      grantsFromRows([
        { account_id: A, level: "view" },
        { account_id: A, level: "manage" },
        { account_id: B, level: "admin" },
        { account_id: "nope", level: "view" },
      ]),
    ).toEqual({ [A]: "manage" });
  });
});

describe("transactions", () => {
  it("view: any visible side; write: manage on every side", () => {
    expect(canViewTx(member, { account_id: C, to_account_id: B })).toBe(true);
    expect(canViewTx(member, { account_id: C, to_account_id: null })).toBe(false);
    expect(canWriteTx(member, { kind: "expense", account_id: A })).toBe(true);
    expect(canWriteTx(member, { kind: "expense", account_id: B })).toBe(false);
    expect(canWriteTx(member, { kind: "expense", account_id: null })).toBe(false);
    expect(canWriteTx(member, { kind: "transfer", account_id: A, to_account_id: B })).toBe(false);
    expect(canWriteTx(member, { kind: "transfer", account_id: A, to_account_id: null })).toBe(
      false,
    );
    const both: Access = { role: "member", grants: { [A]: "manage", [C]: "manage" } };
    expect(canWriteTx(both, { kind: "transfer", account_id: A, to_account_id: C })).toBe(true);
    expect(canWriteTx(ADMIN_ACCESS, { kind: "expense", account_id: null })).toBe(true);
  });

  it("masks transfers to/from hidden wallets", () => {
    const tx = {
      kind: "transfer",
      account_id: A,
      to_account_id: C,
      account: { id: A, name: "Uang Saku" },
      to_account: { id: C, name: "Tabungan Ortu" },
    };
    const m = maskTx(member, tx);
    expect(m.account).toEqual({ id: A, name: "Uang Saku" });
    expect(m.to_account_id).toBeNull();
    expect(m.to_account).toEqual({ id: null, name: OTHER_WALLET, masked: true });
    expect(JSON.stringify(m)).not.toContain("Tabungan Ortu");
    expect(JSON.stringify(m)).not.toContain(C);
    expect(walletLabel(m.to_account, (s) => `[${s}]`)).toBe("[Dompet lain]");
    expect(maskTx(ADMIN_ACCESS, tx)).toBe(tx);
    // Rows without a joined relation still lose the hidden id.
    const bare = maskTx(member, { kind: "transfer", account_id: C, to_account_id: A });
    expect(bare.account_id).toBeNull();
    expect((bare as { account?: { name?: string } }).account?.name).toBe(OTHER_WALLET);
  });
});

describe("routes", () => {
  it("maps paths to modules and limits members", () => {
    expect(routeModule("/accounts/abc")).toBe("accounts");
    expect(routeModule("/nope")).toBeNull();
    expect(canOpenPath("member", "/dashboard")).toBe(true);
    expect(canOpenPath("member", "/accounts/123")).toBe(true);
    expect(canOpenPath("member", "/profile")).toBe(true);
    expect(canOpenPath("member", "/settings")).toBe(false);
    expect(canOpenPath("member", "/rekap")).toBe(false);
    expect(canOpenPath("member", "/gold")).toBe(false);
    expect(canOpenPath("admin", "/gold")).toBe(true);
  });
});

describe("walletNetByMonth", () => {
  it("counts flows of the included wallets only; inner transfers cancel", () => {
    const wallets = new Map([
      [A, { currency: "IDR" }],
      [B, { currency: "USD" }],
    ]);
    const rows = [
      { kind: "income", amount: 100, account_id: A, occurred_at: "2026-01-05" },
      { kind: "expense", amount: 30, account_id: A, occurred_at: "2026-01-06" },
      { kind: "transfer", amount: 50, account_id: A, to_account_id: C, occurred_at: "2026-02-01" },
      { kind: "transfer", amount: 20, account_id: C, to_account_id: A, occurred_at: "2026-02-02" },
      { kind: "transfer", amount: 10, account_id: A, to_account_id: A, occurred_at: "2026-02-03" },
      { kind: "income", amount: 2, account_id: B, occurred_at: "2026-02-04" },
      { kind: "expense", amount: 999, account_id: C, occurred_at: "2026-02-05" },
    ];
    expect(walletNetByMonth(rows, wallets, 16000)).toEqual([
      { month: "2026-01", net: 70 },
      { month: "2026-02", net: -50 + 20 - 10 + 32000 },
    ]);
  });
});
