/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v26 (#96) server behaviour without a real database: token check BEFORE any rate limit or DB,
 * fail closed without a token, dedupe by hash, default "Menunggu verifikasi" vs opt-in
 * auto-confirm, and the atomic claim that prevents double booking.
 */

type Row = any;
const tables: Record<string, Row[]> = {};
const calls: string[] = [];

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "insert" | "delete" = "select";
  let patch: Row = {};
  let single = false;
  const rows = () => (tables[table] ??= []);
  const api: any = {
    select: () => api,
    insert: (r: Row) => ((op = "insert"), (patch = r), api),
    update: (p: Row) => ((op = "update"), (patch = p), api),
    delete: () => ((op = "delete"), api),
    eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
    is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), api),
    in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), api),
    not: () => api,
    lt: () => api,
    order: () => api,
    range: () => api,
    limit: () => api,
    maybeSingle: () => ((single = true), api),
    single: () => ((single = true), api),
    then: (res: (v: any) => void) => {
      calls.push(`${op}:${table}`);
      if (op === "insert") {
        if (table === "payment_signals" && rows().some((r) => r.hash === patch.hash))
          return res({ data: null, error: { message: "duplicate key", code: "23505" } });
        const r = { id: `${table}-${rows().length + 1}-0000-0000`, ...patch };
        rows().push(r);
        return res({ data: single ? r : [r], error: null });
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      const out = hit.map((r) => ({ ...r }));
      return res({ data: single ? (out[0] ?? null) : out, error: null });
    },
  };
  return api;
}

vi.mock("../lib/db.server", () => ({ db: () => ({ from: (t: string) => query(t) }) }));

let cfg: Record<string, string | undefined> = {};
vi.mock("../lib/integrations.server", () => ({
  getIntegrations: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, cfg[k]])),
}));
const booked: number[] = [];
vi.mock("../lib/invoices.server", () => ({
  loadInvoice: async (id: string) => tables["invoices"]!.find((r) => r.id === id) ?? null,
  bookPayment: async (inv: any, p: any) => {
    booked.push(p.amount);
    const id = `pay${booked.length}`;
    tables["invoice_payments"]!.push({ id, invoice_id: inv.id, reference: p.reference });
    return { invoice: { ...inv, paid: inv.paid + p.amount, status: "paid" }, paymentId: id };
  },
}));
const extras: number[] = [];
vi.mock("../lib/finance.server", () => ({
  isMissingTable: (e: any) => e?.code === "42P01",
  logActivity: async () => undefined,
  today: () => "2026-11-01",
  createFromExternal: async (t: any) => (extras.push(t.amount), { transaction: { id: "tx" } }),
}));
const mails: number[] = [];
vi.mock("../lib/invoice-email.server", () => ({
  sendPaymentConfirmation: async (_i: any, a: number) => void mails.push(a),
}));
vi.mock("../lib/monitoring.server", () => ({ logError: () => undefined }));
const rateCalls: string[] = [];
let rateOk = true;
vi.mock("../lib/rate-limit.server", () => ({
  subjectHash: (v: string) => v,
  rateHit: async (r: any, s: string) => (rateCalls.push(`${r[0].name}|${s}`), rateOk),
}));

import { confirmSignal, handleNotify, loadSignal } from "@/lib/payment-signals.server";

const TOKEN = "t".repeat(40);
const headers = (token?: string) => new Headers(token ? { authorization: `Bearer ${token}` } : {});
const body =
  (o: Record<string, unknown> = {}) =>
  async () => ({
    ok: true as const,
    value: {
      app: "BCA mobile",
      package: "com.bca",
      title: "Dana Masuk",
      text: "Rp 150.123,00 dari BUDI",
      posted_at: String(Date.now()),
      ...o,
    },
  });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["invoices"] = [
    {
      id: "inv1",
      number: "INV-1",
      customer_name: "Budi",
      status: "unpaid",
      total: 150000,
      paid: 0,
      unique_code: 123,
      account_id: "acc1",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  tables["invoice_payments"] = [];
  tables["payment_signals"] = [];
  tables["payment_notify_formats"] = [
    {
      id: "f1",
      name: "BCA",
      app_match: "com.bca",
      title_match: null,
      text_match: null,
      match_mode: "contains",
      amount_regex: String.raw`(?:Rp\.?|IDR)\s?(?<amount>\d[\d.,]*)`,
      must_contain: "masuk",
      ignore_contains: "keluar",
      account_id: null,
      enabled: true,
    },
  ];
  cfg = { MACRODROID_TOKEN: TOKEN, MACRODROID_AUTO_CONFIRM: "false" };
  booked.length = 0;
  extras.length = 0;
  mails.length = 0;
  rateCalls.length = 0;
  calls.length = 0;
  rateOk = true;
});

describe("POST /api/public/payments/notify", () => {
  it("fails closed without a configured token (no rate limit, no DB)", async () => {
    cfg = {};
    const r = await handleNotify(headers(TOKEN), body(), "1.1.1.1");
    expect(r.status).toBe(503);
    expect(rateCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("checks the token before anything else; only bad tokens are IP limited", async () => {
    const read = vi.fn(body());
    const r = await handleNotify(headers("wrong"), read, "1.1.1.1");
    expect(r.status).toBe(401);
    expect(rateCalls).toEqual(["notify:bad|ip:1.1.1.1"]);
    expect(calls).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    rateOk = false;
    expect((await handleNotify(headers(), read, "1.1.1.1")).status).toBe(429);
  });

  it("valid device: per-device limit (never per IP), stores a matched signal awaiting review", async () => {
    const r = await handleNotify(headers(TOKEN), body(), "9.9.9.9");
    expect(r).toEqual({ status: 200, body: { ok: true, status: "matched" } });
    expect(rateCalls.every((c) => c.startsWith("notify:device"))).toBe(true);
    const s = tables["payment_signals"]![0];
    expect(s).toMatchObject({ status: "matched", invoice_id: "inv1", amount: 150123 });
    expect(s.excerpt).toContain("Rp 150.123,00");
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(booked).toEqual([]);
  });

  it("deduplicates a re-sent notification", async () => {
    const b = body({ posted_at: "1761990000000" });
    await handleNotify(headers(TOKEN), b, "9.9.9.9");
    const r = await handleNotify(headers(TOKEN), b, "9.9.9.9");
    expect(r.body).toMatchObject({ ok: true, duplicate: true });
    expect(tables["payment_signals"]).toHaveLength(1);
  });

  it("stores outgoing/unknown notifications as ignored or unmatched", async () => {
    await handleNotify(headers(TOKEN), body({ text: "Dana keluar Rp 10.000" }), "x");
    await handleNotify(headers(TOKEN), body({ text: "Dana masuk Rp 99.000" }), "x");
    expect(tables["payment_signals"]!.map((s) => s.status)).toEqual(["ignored", "unmatched"]);
  });

  it("refuses rate-limited devices and bodies without text", async () => {
    expect((await handleNotify(headers(TOKEN), body({ title: "", text: "" }), "x")).status).toBe(
      400,
    );
    rateOk = false;
    expect((await handleNotify(headers(TOKEN), body(), "x")).status).toBe(429);
  });

  it("auto-confirm (opt-in) books once: payment + unique code income + email", async () => {
    cfg["MACRODROID_AUTO_CONFIRM"] = "true";
    const r = await handleNotify(headers(TOKEN), body(), "x");
    expect(r.body).toMatchObject({ status: "confirmed" });
    expect(booked).toEqual([150000]);
    expect(extras).toEqual([123]);
    expect(mails).toEqual([150000]);
    expect(tables["payment_signals"]![0]).toMatchObject({
      status: "confirmed",
      payment_id: "pay1",
    });
  });
});

describe("confirmSignal claim", () => {
  it("never books twice under concurrent confirms", async () => {
    await handleNotify(headers(TOKEN), body(), "x");
    const sig = (await loadSignal(tables["payment_signals"]![0].id))!;
    const inv = tables["invoices"]![0];
    const results = await Promise.allSettled([
      confirmSignal(sig, inv, 150000, 123, null, "admin"),
      confirmSignal(sig, inv, 150000, 123, null, "admin"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(booked).toEqual([150000]);
    await expect(
      confirmSignal({ ...sig, status: "confirmed" }, inv, 150000, 0, null, "admin"),
    ).rejects.toThrow("Notifikasi ini sudah diproses");
  });
});
