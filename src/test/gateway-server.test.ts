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
      if (failSelect === table && op === "select")
        return res({ data: null, error: { message: "boom", code: "XX000" } });
      if (op === "insert") {
        const r = { id: `id${rows().length + 1}`, ...patch };
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
vi.mock("../lib/invoices.server", () => ({
  loadInvoice: async () => ({
    id: "inv",
    number: "INV-1",
    customer_name: "Budi",
    status: "unpaid",
  }),
  loadPayment: async () => null,
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
vi.mock("../lib/finance.server", () => ({
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
vi.mock("../lib/gateway/midtrans.server", () => ({
  midtransConfig: async () => ({ serverKey: "SB-Mid-server-TEST", overridden: false }),
  midtrans: {
    verifyWebhook: (_c: any, b: any) =>
      b?.good ? { ok: true, orderId: "INV-1-a" } : { ok: false, status: 401, error: "x" },
    fetchStatus: async () => null,
  },
}));

import {
  applyState,
  assertPaymentNotGateway,
  handleMidtransWebhook,
  releaseInvoiceGateway,
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
  rateCalls.length = 0;
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
