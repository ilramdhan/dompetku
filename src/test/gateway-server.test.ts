/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v25 (#97) server behaviour without a real database: the booking claim protocol (no double
 * booking, an in-flight claim is never released by another request even when last_error is set),
 * the webhook check order (signature before any rate limit) and fail-closed delete guards.
 */

type Row = any;
const tables: Record<string, Row[]> = {};
let failSelect: string | null = null;
/** Fails the next update that sets this column (e.g. "snap_token"). */
let failUpdateOf: string | null = null;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "insert" | "delete" = "select";
  let patch: Row = {};
  let single = false;
  let limitN = Infinity;
  const rows = () => (tables[table] ??= []);
  const api: any = {
    select: () => api,
    insert: (r: Row) => {
      op = "insert";
      patch = r;
      return api;
    },
    update: (p: Row) => {
      op = "update";
      patch = p;
      return api;
    },
    delete: () => {
      op = "delete";
      return api;
    },
    eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
    is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), api),
    in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), api),
    like: (k: string, v: string) => (
      filters.push((r) => String(r[k] ?? "").startsWith(v.replace(/%$/, ""))),
      api
    ),
    order: () => api,
    limit: (n: number) => ((limitN = n), api),
    maybeSingle: () => ((single = true), api),
    single: () => ((single = true), api),
    then: (res: (v: any) => void) => {
      if (op === "update" && failUpdateOf && failUpdateOf in patch) {
        failUpdateOf = null;
        return res({ data: null, error: { message: "write failed", code: "XX000" } });
      }
      if (failSelect === table && op === "select")
        return res({ data: null, error: { message: "boom", code: "XX000" } });
      if (op === "insert") {
        // Column default of gateway_transactions.status.
        const def = table === "gateway_transactions" ? { status: "pending" } : {};
        const r = { id: `id${rows().length + 1}`, ...def, ...patch };
        rows().push(r);
        return res({ data: single ? r : [r], error: null });
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      const out = hit.slice(0, limitN).map((r) => ({ ...r }));
      return res({ data: single ? (out[0] ?? null) : out, error: null });
    },
  };
  return api;
}

vi.mock("../lib/db.server", () => ({ db: () => ({ from: (t: string) => query(t) }) }));

const booked: number[] = [];
let bookGate: Promise<void> = Promise.resolve();
let bookError: string | null = null;
let invAccount: string | null = null;
let payment: any = null;
vi.mock("../lib/invoices.server", () => ({
  loadInvoice: async () => ({
    id: "inv",
    number: "INV-1",
    customer_name: "Budi",
    status: "unpaid",
    account_id: invAccount,
    total: 250000,
    paid: 0,
  }),
  loadPayment: async () => payment,
  syncInvoice: async () => ({}),
  bookPayment: async (_inv: any, p: any) => {
    await bookGate;
    if (bookError) throw new Error(bookError);
    booked.push(p.amount);
    const id = `pay${booked.length}`;
    tables["invoice_payments"]!.push({ id, invoice_id: "inv", reference: p.reference });
    return { invoice: {}, paymentId: id };
  },
}));
const external: any[] = [];
vi.mock("../lib/finance.server", () => ({
  createFromExternal: async (t: any, opts: any) => {
    const dup = external.find((x) => x.external_id === t.external_id);
    if (dup) return { transaction: dup, duplicate: true };
    const tx = { ...t, account_id: opts?.account_id ?? null };
    external.push(tx);
    return { transaction: tx, duplicate: false };
  },
  isMissingTable: (e: any) => e?.code === "42P01",
  logActivity: async () => undefined,
  today: () => "2026-10-30",
}));
vi.mock("../lib/invoice-email.server", () => ({ sendPaymentConfirmation: async () => undefined }));
vi.mock("../lib/monitoring.server", () => ({ logError: () => undefined }));
const rateCalls: string[] = [];
vi.mock("../lib/rate-limit.server", () => ({
  subjectHash: (v: string) => v,
  rateHit: async (_r: any, s: string) => (rateCalls.push(s), true),
}));
let fees: any = null;
let expireOk = true;
let deadStatus: string | null = null;
const expired: string[] = [];
const created: string[] = [];
let onCreate: (() => Promise<void>) | null = null;
vi.mock("../lib/invoice-share.server", () => ({
  activeShareInvoiceId: async () => "inv",
  hashShareToken: (t: string) => t,
}));
vi.mock("../lib/gateway/midtrans.server", () => ({
  midtransConfig: async () => ({
    serverKey: "SB-Mid-server-TEST",
    overridden: false,
    fees,
    partial: true,
    clientKey: null,
    production: false,
  }),
  midtrans: {
    expire: async (_c: any, orderId: string) => (expired.push(orderId), expireOk),
    createPayment: async (_c: any, x: any) => {
      created.push(x.orderId);
      if (onCreate) await onCreate();
      return { token: `snap-${x.orderId}`, redirectUrl: `https://pay/${x.orderId}` };
    },
    verifyWebhook: (_c: any, b: any) =>
      b?.good ? { ok: true, orderId: "INV-1-a" } : { ok: false, status: 401, error: "x" },
    fetchStatus: async (_c: any, orderId: string) =>
      deadStatus ? { ...state, orderId, status: deadStatus } : null,
  },
}));

import {
  applyState,
  assertPaymentNotGateway,
  handleMidtransWebhook,
  releaseInvoiceGateway,
  retirePendingOrders,
  startGatewayPayment,
} from "@/lib/gateway/payments.server";

const state = {
  orderId: "INV-1-a",
  gatewayTxId: "tx-1",
  status: "success" as const,
  providerStatus: "settlement",
  grossAmount: 150000,
  paymentType: "qris",
  refundedAmount: 0,
  refunds: [],
  raw: {},
};
const baseRow = () => ({
  id: "g1",
  invoice_id: "inv",
  order_id: "INV-1-a",
  gateway_tx_id: null,
  status: "pending",
  gross_amount: 150000,
  refunded_amount: 0,
  payment_type: null,
  payment_id: null,
  claimed_at: null,
  last_error: null,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["gateway_transactions"] = [baseRow()];
  tables["invoice_payments"] = [];
  booked.length = 0;
  bookGate = Promise.resolve();
  bookError = null;
  failSelect = null;
  failUpdateOf = null;
  rateCalls.length = 0;
  external.length = 0;
  fees = null;
  invAccount = null;
  payment = null;
  expireOk = true;
  deadStatus = null;
  expired.length = 0;
  created.length = 0;
  onCreate = null;
});

describe("booking claim", () => {
  it("books exactly once for concurrent syncs", async () => {
    let open!: () => void;
    bookGate = new Promise((r) => (open = r));
    const row = { ...baseRow(), status: "pending" } as any;
    const a = applyState(row, state);
    const b = applyState({ ...row }, state);
    await new Promise((r) => setTimeout(r, 0));
    open();
    await Promise.all([a, b]);
    expect(booked).toEqual([150000]);
    expect(tables["gateway_transactions"]![0]!.payment_id).toBe("pay1");
  });

  it("never releases an in-flight claim because of last_error", async () => {
    const g = tables["gateway_transactions"]![0]!;
    Object.assign(g, {
      status: "success",
      claimed_at: new Date().toISOString(),
      last_error: "Pembayaran melebihi sisa tagihan",
    });
    const r = await applyState({ ...g } as any, state);
    expect(booked).toEqual([]);
    expect(r.booked).toBe(false);
    expect(g.claimed_at).not.toBeNull();
  });

  it("releases its own claim after a business error and clears last_error on the next claim", async () => {
    bookError = "Invoice ini tidak bisa menerima pembayaran";
    const first = await applyState(baseRow() as any, state);
    const g = tables["gateway_transactions"]![0]!;
    expect(first.booked).toBe(false);
    expect(g.claimed_at).toBeNull();
    expect(g.last_error).toBe(bookError);
    bookError = null;
    const again = await applyState({ ...g } as any, state);
    expect(again.booked).toBe(true);
    expect(g.last_error).toBeNull();
    expect(booked).toEqual([150000]);
  });

  it("recovers a stale claim by linking a payment booked under the order id", async () => {
    const g = tables["gateway_transactions"]![0]!;
    Object.assign(g, {
      status: "success",
      claimed_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    tables["invoice_payments"]!.push({ id: "old", invoice_id: "inv", reference: "INV-1-a" });
    const r = await applyState({ ...g } as any, state);
    expect(booked).toEqual([]);
    expect(r.row.payment_id).toBe("old");
  });

  it("keeps the status and flags a chargeback without refund entries", async () => {
    const g = tables["gateway_transactions"]![0]!;
    Object.assign(g, { status: "success", payment_id: "p" });
    const r = await applyState(
      { ...g } as any,
      {
        ...state,
        status: "refunded",
        providerStatus: "chargeback",
      } as any,
    );
    expect(g.status).toBe("success");
    expect(r.note).toMatch(/Chargeback/);
  });
});

describe("webhook order", () => {
  it("rate limits only unsigned/bad requests, never signed ones", async () => {
    const bad = await handleMidtransWebhook({}, "1.2.3.4");
    expect(bad.status).toBe(401);
    expect(rateCalls).toEqual(["ip:1.2.3.4"]);
    rateCalls.length = 0;
    const good = await handleMidtransWebhook({ good: true }, "1.2.3.4");
    expect(good.status).toBe(200);
    expect(rateCalls).toEqual([]);
  });
});

describe("delete guards fail closed", () => {
  it("throw on DB errors other than a missing table", async () => {
    failSelect = "gateway_transactions";
    await expect(releaseInvoiceGateway("inv")).rejects.toThrow("boom");
    await expect(assertPaymentNotGateway("p")).rejects.toThrow("boom");
  });
});

describe("MDR fee (#124)", () => {
  const mdrRows = () => external.filter((x) => String(x.external_id).startsWith("invoice_mdr:"));

  it("books nothing without a schedule (unchanged v25 behaviour)", async () => {
    invAccount = "acc";
    await applyState(baseRow() as any, state);
    expect(booked).toEqual([150000]);
    expect(mdrRows()).toEqual([]);
  });

  it("books the fee once as a Biaya Admin expense on the invoice wallet", async () => {
    invAccount = "acc";
    fees = { qris: { percent: 0.7, flat: 0 } };
    let open!: () => void;
    bookGate = new Promise((r) => (open = r));
    const a = applyState(baseRow() as any, state);
    const b = applyState(baseRow() as any, state);
    await new Promise((r) => setTimeout(r, 0));
    open();
    await Promise.all([a, b]);
    // Re-sync of an already linked row books nothing new.
    await applyState({ ...tables["gateway_transactions"]![0]! } as any, state);
    expect(booked).toEqual([150000]);
    expect(mdrRows()).toHaveLength(1);
    expect(mdrRows()[0]).toMatchObject({
      kind: "expense",
      amount: 1050,
      category: "Biaya Admin",
      account_id: "acc",
      external_id: "invoice_mdr:g1",
    });
  });

  it("retries the fee after a crash between booking and linking, without a second payment", async () => {
    invAccount = "acc";
    fees = { "*": { percent: 0, flat: 4000 } };
    const g = tables["gateway_transactions"]![0]!;
    Object.assign(g, {
      status: "success",
      claimed_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    tables["invoice_payments"]!.push({ id: "old", invoice_id: "inv", reference: "INV-1-a" });
    await applyState({ ...g } as any, state);
    expect(booked).toEqual([]);
    expect(mdrRows()).toHaveLength(1);
    expect(mdrRows()[0]!.amount).toBe(4000);
  });

  it("refunds never book, repeat or reverse the fee", async () => {
    invAccount = "acc";
    fees = { qris: { percent: 0.7, flat: 0 } };
    await applyState(baseRow() as any, state);
    payment = { id: "pay1", amount: 150000 };
    tables["invoice_payments"]![0]!.amount = 150000;
    const g = tables["gateway_transactions"]![0]!;
    await applyState({ ...g } as any, {
      ...state,
      status: "refunded",
      providerStatus: "refund",
      refundedAmount: 150000,
      refunds: [{ key: "rf-g1-1", amount: 150000, at: null }],
    });
    expect(mdrRows()).toHaveLength(1);
    expect(
      external.filter((x) => String(x.external_id).startsWith("invoice_refund:")),
    ).toHaveLength(1);
    expect(external.filter((x) => x.kind === "income")).toEqual([]);
  });

  it("never fails the booking when the fee cannot be booked (no wallet)", async () => {
    fees = { qris: { percent: 0.7, flat: 0 } };
    const r = await applyState(baseRow() as any, state);
    expect(r.booked).toBe(true);
    expect(mdrRows()).toEqual([]);
  });
});

describe("one live pending order per invoice (review L1, #124)", () => {
  const TOKEN = "t".repeat(43);
  const pendingRow = (id: string, order: string, gross: number) => ({
    ...baseRow(),
    id,
    order_id: order,
    gross_amount: gross,
    status: "pending",
    snap_token: "s",
    redirect_url: "u",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const gw = () => tables["gateway_transactions"]!;
  const live = () => gw().filter((r) => r.status === "pending");

  it("keeps a row pending when Midtrans refuses the expire, and retries it next time", async () => {
    tables["gateway_transactions"] = [pendingRow("old", "INV-1-old", 100000)];
    expireOk = false;
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(1);
    expect(gw()[0]!.status).toBe("pending");
    expireOk = true;
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(0);
    expect(gw()[0]!.status).toBe("expired");
    expect(expired).toEqual(["INV-1-old", "INV-1-old"]);
  });

  it("retires a row whose expire failed when Get Status says it is already dead", async () => {
    tables["gateway_transactions"] = [pendingRow("old", "INV-1-old", 100000)];
    expireOk = false;
    deadStatus = "expired";
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(0);
    expect(gw()[0]!.status).toBe("expired");
  });

  it("refuses a new amount while an older order cannot be expired", async () => {
    tables["gateway_transactions"] = [pendingRow("old", "INV-1-old", 100000)];
    expireOk = false;
    await expect(startGatewayPayment(TOKEN, "1.1.1.1", null, 50000)).rejects.toThrow(
      /gagal dibuat/,
    );
    expect(created).toEqual([]);
    expect(live().map((r) => r.id)).toEqual(["old"]);
  });

  it("replaces an order of another amount and reuses one of the same amount", async () => {
    tables["gateway_transactions"] = [pendingRow("old", "INV-1-old", 100000)];
    const a = await startGatewayPayment(TOKEN, "1.1.1.1", null, 50000);
    expect(created).toHaveLength(1);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.gross_amount).toBe(50000);
    const b = await startGatewayPayment(TOKEN, "1.1.1.1", null, 50000);
    expect(b.token).toBe(a.token);
    expect(created).toHaveLength(1);
  });

  it("leaves at most one live order when two amounts race", async () => {
    tables["gateway_transactions"] = [];
    // Request B runs completely while A is creating its Snap order.
    onCreate = async () => {
      onCreate = null;
      await startGatewayPayment(TOKEN, "1.1.1.1", null, 250000).catch(() => undefined);
    };
    const a = startGatewayPayment(TOKEN, "1.1.1.1", null, 50000);
    await a.catch(() => undefined);
    expect(live().length).toBeLessThanOrEqual(1);
    // Every Snap order created is either the live row or was expired at Midtrans.
    const liveOrders = live().map((r) => r.order_id);
    for (const o of created) expect(liveOrders.includes(o) || expired.includes(o)).toBe(true);
  });

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("ages out an expired Snap order Midtrans neither expires nor knows (review M1)", async () => {
    tables["gateway_transactions"] = [
      { ...pendingRow("old", "INV-1-old", 100000), expires_at: ago(11 * 60_000) },
    ];
    expireOk = false;
    deadStatus = null; // Get Status 404
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(0);
    expect(gw()[0]!.status).toBe("expired");
    // ...so a new order for another amount is no longer blocked.
    await startGatewayPayment(TOKEN, "1.1.1.1", null, 50000);
    expect(created).toHaveLength(1);
  });

  it("ages out a tokenless row, by created_at + 24 h when expires_at is missing (review M1)", async () => {
    expireOk = false;
    tables["gateway_transactions"] = [
      { ...pendingRow("a", "INV-1-a", 100000), snap_token: null, created_at: ago(3 * 60_000) },
      {
        ...pendingRow("b", "INV-1-b", 100000),
        expires_at: null,
        created_at: ago(24 * 3_600_000 + 11 * 60_000),
      },
    ];
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(0);
    expect(gw().map((r) => r.status)).toEqual(["expired", "expired"]);
  });

  it("keeps a still-valid or just-created row pending when expire fails and Get Status is 404", async () => {
    expireOk = false;
    tables["gateway_transactions"] = [
      pendingRow("live", "INV-1-live", 100000),
      { ...pendingRow("new", "INV-1-new", 100000), snap_token: null, created_at: ago(5_000) },
      { ...pendingRow("grace", "INV-1-g", 100000), expires_at: ago(5 * 60_000) },
    ];
    expect(await retirePendingOrders("inv", { amount: 250000 })).toBe(3);
    expect(live()).toHaveLength(3);
  });

  it("books a paid-but-unsynced old order through the claim instead of only blocking (review I6)", async () => {
    tables["gateway_transactions"] = [pendingRow("g1", "INV-1-a", 150000)];
    expireOk = false;
    deadStatus = "success";
    expect(await retirePendingOrders("inv", { amount: 50000 })).toBe(1);
    expect(booked).toEqual([150000]);
    expect(gw()[0]).toMatchObject({ status: "success", payment_id: "pay1" });
    // A second pass books nothing more and no longer blocks (the row is not pending).
    expect(await retirePendingOrders("inv", { amount: 50000 })).toBe(0);
    expect(booked).toEqual([150000]);
  });

  it("never hands out a token the row could not save (review L5)", async () => {
    tables["gateway_transactions"] = [];
    failUpdateOf = "snap_token";
    await expect(startGatewayPayment(TOKEN, "1.1.1.1", null, 50000)).rejects.toThrow(
      /gagal dibuat/,
    );
    expect(created).toHaveLength(1);
    expect(expired).toEqual(created); // the new Snap order was expired at Midtrans
    expect(gw()[0]!.status).toBe("expired");
  });

  it("keeps token and expiry on a pending row when the save and the expire both fail (L5)", async () => {
    tables["gateway_transactions"] = [];
    failUpdateOf = "snap_token";
    expireOk = false;
    await expect(startGatewayPayment(TOKEN, "1.1.1.1", null, 50000)).rejects.toThrow(
      /gagal dibuat/,
    );
    const row = gw()[0]!;
    expect(row.status).toBe("pending");
    expect(row.snap_token).toBe(`snap-${created[0]}`);
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
  });
});
