/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v26 (#96) server behaviour without a real database: token check BEFORE any rate limit or DB,
 * fail closed without a token, dedupe by hash, default "Menunggu verifikasi" vs opt-in
 * auto-confirm, and the atomic claim that prevents double booking. The fake emulates the partial
 * unique index payment_signals_invoice_claim_idx (one claim per invoice) and yields between calls
 * so parallel requests interleave like real round trips.
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
    neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), api),
    is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), api),
    in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), api),
    not: (k: string, op: string, v: any) => {
      if (op === "is") filters.push((r) => (r[k] ?? null) !== v);
      else if (op === "in") {
        const list = String(v).replace(/[()]/g, "").split(",");
        filters.push((r) => !list.includes(r[k]));
      }
      return api;
    },
    lt: (k: string, v: any) => (filters.push((r) => r[k] != null && r[k] < v), api),
    order: () => api,
    range: () => api,
    limit: () => api,
    maybeSingle: () => ((single = true), api),
    single: () => ((single = true), api),
    then: async (res: (v: any) => void) => {
      calls.push(`${op}:${table}`);
      await new Promise((r) => setTimeout(r, 0));
      if (op === "insert") {
        if (table === "payment_signals" && rows().some((r) => r.hash === patch.hash))
          return res({ data: null, error: { message: "duplicate key", code: "23505" } });
        const r = { id: `${table}-${rows().length + 1}-0000-0000`, ...patch };
        rows().push(r);
        return res({ data: single ? r : [r], error: null });
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update" && table === "payment_signals" && patch.claimed_at)
        for (const r of hit) {
          const inv = patch.invoice_id ?? r.invoice_id;
          if (rows().some((o) => o !== r && o.claimed_at && o.invoice_id === inv))
            return res({ data: null, error: { message: "duplicate key", code: "23505" } });
        }
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
  loadInvoice: async (id: string) => {
    const r = tables["invoices"]!.find((x) => x.id === id);
    return r ? { ...r } : null;
  },
  // Like the real one: insert, re-check the sum (concurrent payments), roll back on overshoot.
  bookPayment: async (inv: any, p: any) => {
    const id = `pay${tables["invoice_payments"]!.length + 1}`;
    tables["invoice_payments"]!.push({
      id,
      invoice_id: inv.id,
      reference: p.reference,
      amount: p.amount,
    });
    await new Promise((r) => setTimeout(r, 1));
    const mine = tables["invoice_payments"]!.filter((x) => x.invoice_id === inv.id);
    const sum = mine.reduce((a, x) => a + x.amount, 0);
    if (sum > inv.total + 0.005) {
      tables["invoice_payments"] = tables["invoice_payments"]!.filter((x) => x.id !== id);
      throw new Error("Pembayaran melebihi sisa tagihan");
    }
    booked.push(p.amount);
    const row = tables["invoices"]!.find((x) => x.id === inv.id);
    row.paid = sum;
    row.status = sum >= row.total - 0.005 ? "paid" : "partial";
    return { invoice: { ...row }, paymentId: id };
  },
}));
let held = new Set<string>();
vi.mock("../lib/gateway/payments.server", () => ({
  refundHeldInvoices: async (ids: string[]) => new Set(ids.filter((i) => held.has(i))),
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

import {
  confirmSignal,
  ensureUniqueCode,
  handleNotify,
  loadSignal,
  peekUniqueCode,
  signalHash,
  tokenFrom,
  uniqueCodeExternalIds,
} from "@/lib/payment-signals.server";
import { splitSignalAmount } from "@/lib/bank-notify";

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

/**
 * Starts each call in its own macrotask. Vitest can resolve a mocked module to the real one when
 * several dynamic imports of it start in the same microtask drain; the fake DB yields a macrotask
 * per call, so the requests still interleave at every round trip.
 */
const parallel = <T>(fns: (() => Promise<T>)[]) =>
  Promise.allSettled(fns.map((f) => new Promise((r) => setTimeout(r, 0)).then(f)));

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
  held = new Set();
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
    const plan = () => ({ pay: 150000, extra: 123 });
    const results = await parallel([
      () => confirmSignal(sig, "inv1", plan, null, "admin"),
      () => confirmSignal(sig, "inv1", plan, null, "admin"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(booked).toEqual([150000]);
    await expect(
      confirmSignal({ ...sig, status: "confirmed" }, "inv1", plan, null, "admin"),
    ).rejects.toThrow("Notifikasi ini sudah diproses");
  });
});

describe("auto-confirm trust (security review #1 no. 2)", () => {
  beforeEach(() => {
    cfg["MACRODROID_AUTO_CONFIRM"] = "true";
  });

  it("never auto-books a look-alike app: substring of the package is not a match", async () => {
    tables["payment_notify_formats"]![0].app_match = "bca";
    const r = await handleNotify(
      headers(TOKEN),
      body({ package: "com.abcapp", app: "ABC App" }),
      "x",
    );
    expect(r.body).toMatchObject({ status: "ignored" });
    expect(booked).toEqual([]);
  });

  it("an app-name-only format matches but waits for the admin", async () => {
    tables["payment_notify_formats"]![0].app_match = "bca";
    const r = await handleNotify(headers(TOKEN), body({ package: "com.fake", app: "BCA" }), "x");
    expect(r.body).toMatchObject({ status: "matched" });
    expect(booked).toEqual([]);
    expect(tables["payment_signals"]![0].reason).toMatch(/Tidak dikonfirmasi otomatis/);
  });

  it("the generic fallback never auto-books", async () => {
    cfg["MACRODROID_GENERIC"] = "true";
    tables["payment_notify_formats"] = [];
    const r = await handleNotify(headers(TOKEN), body({ package: "com.whatsapp" }), "x");
    expect(r.body).toMatchObject({ status: "matched" });
    expect(booked).toEqual([]);
  });

  it("a package-pinned format books (dot-segment sub-package included)", async () => {
    const r = await handleNotify(headers(TOKEN), body({ package: "com.bca.mobile" }), "x");
    expect(r.body).toMatchObject({ status: "confirmed" });
    expect(booked).toEqual([150000]);
  });
});

describe("refund hold (security review #1 no. 3)", () => {
  it("ingest keeps a held invoice matched, never auto-books it", async () => {
    cfg["MACRODROID_AUTO_CONFIRM"] = "true";
    held.add("inv1");
    const r = await handleNotify(headers(TOKEN), body(), "x");
    expect(r.body).toMatchObject({ status: "matched" });
    expect(booked).toEqual([]);
    expect(tables["payment_signals"]![0].reason).toMatch(/refund/);
  });

  it("manual confirm is refused while the invoice is held and the claim is released", async () => {
    await handleNotify(headers(TOKEN), body(), "x");
    const sig = (await loadSignal(tables["payment_signals"]![0].id))!;
    held.add("inv1");
    await expect(
      confirmSignal(sig, "inv1", () => ({ pay: 150000, extra: 123 }), null, "admin"),
    ).rejects.toThrow(/Tagih ulang/);
    expect(booked).toEqual([]);
    expect(tables["payment_signals"]![0].claimed_at).toBeNull();
  });

  it("hides the unique code and never assigns one while held", async () => {
    held.add("inv1");
    expect(await peekUniqueCode("inv1")).toBeNull();
    tables["invoices"]![0].unique_code = null;
    expect(await ensureUniqueCode("inv1")).toBeNull();
    expect(tables["invoices"]![0].unique_code).toBeNull();
  });
});

describe("parallel auto-confirm (E2E #1 FAIL)", () => {
  it("different notifications for one invoice book exactly once; siblings are superseded", async () => {
    cfg["MACRODROID_AUTO_CONFIRM"] = "true";
    const t0 = Date.now();
    const settled = await parallel(
      [0, 1, 2, 3].map(
        (i) => () => handleNotify(headers(TOKEN), body({ posted_at: String(t0 - i * 1000) }), "x"),
      ),
    );
    const results = settled.map((r) => (r.status === "fulfilled" ? r.value.status : 0));
    expect(results).toEqual([200, 200, 200, 200]);
    expect(booked).toEqual([150000]);
    expect(extras).toEqual([123]);
    const statuses = tables["payment_signals"]!.map((s) => s.status).sort();
    expect(statuses).toEqual(["confirmed", "ignored", "ignored", "ignored"]);
    expect(tables["payment_signals"]!.every((s) => !s.claimed_at)).toBe(true);
    expect(
      tables["payment_signals"]!.filter((s) => s.status === "ignored").map((s) => s.reason),
    ).toEqual(Array(3).fill("Invoice sudah lunas atau tidak terbuka lagi"));
  }, 20_000);

  it("two admin confirms of different signals: the second sees the fresh remaining amount", async () => {
    tables["invoices"]![0].total = 300000;
    tables["payment_signals"] = ["s1", "s2"].map((id) => ({
      id,
      status: "unmatched",
      amount: 200000,
      invoice_id: null,
      payment_id: null,
      claimed_at: null,
    }));
    const plan = () => ({ pay: 200000, extra: 0 });
    const [a, b] = await parallel(
      ["s1", "s2"].map(
        (id) => async () => confirmSignal((await loadSignal(id))!, "inv1", plan, null, "admin"),
      ),
    );
    // Serialised: one books, the other is refused up front (no insert + rollback race).
    expect(booked).toEqual([200000]);
    const rejected = [a, b].find((r) => r!.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/melebihi sisa/);
    expect(tables["payment_signals"]!.every((s) => !s.claimed_at)).toBe(true);
  });
});

describe("unique codes (security review #1 no. 4, 5)", () => {
  it("the public page only reads; the code is assigned by an admin action", async () => {
    tables["invoices"]![0].unique_code = null;
    expect(await peekUniqueCode("inv1")).toBeNull();
    expect(calls.filter((c) => c.startsWith("update:"))).toEqual([]);
    const code = await ensureUniqueCode("inv1");
    expect(code).toBeGreaterThanOrEqual(1);
    expect(await peekUniqueCode("inv1")).toBe(code);
  });

  it("a released code cools down for 48 h before another invoice may get it", async () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    tables["invoices"] = Array.from({ length: 999 }, (_, i) => ({
      id: `inv${i + 1}`,
      status: i === 0 ? "paid" : "unpaid",
      unique_code: i + 1,
      unique_code_released_at: i === 0 ? new Date(now - 47 * 3_600_000).toISOString() : null,
      total: 1000,
      paid: 0,
    }));
    tables["invoices"].push({ id: "new", status: "unpaid", unique_code: null, total: 1, paid: 0 });
    expect(await ensureUniqueCode("new", now)).toBeNull(); // code 1 is still cooling down
    expect(tables["invoices"][0].unique_code).toBe(1);
    expect(await ensureUniqueCode("new", now + 2 * 3_600_000)).toBe(1); // cooldown over
    expect(tables["invoices"][0]).toMatchObject({
      unique_code: null,
      unique_code_released_at: null,
    });
  });

  it("finds the Kode unik income of a payment for refund/delete", async () => {
    tables["payment_signals"] = [{ id: "sig-1", payment_id: "pay9" }];
    expect(await uniqueCodeExternalIds(["pay9"])).toEqual(["invoice_code:sig-1"]);
    expect(await uniqueCodeExternalIds([])).toEqual([]);
  });
});

describe("dedupe and token header (security review #1 no. 6, 9)", () => {
  const n = { package: "com.bca", app: "BCA", title: "Masuk", text: "Rp 10.000" };

  it("without posted_at, two identical transfers a minute apart are both kept", () => {
    expect(signalHash(n, null, 1_000_000)).not.toBe(signalHash(n, null, 1_060_000));
    expect(signalHash(n, 5, 1)).toBe(signalHash(n, 5, 999_999));
  });

  it("an empty X-Device-Token header does not hide a valid Bearer token", async () => {
    const h = new Headers({ "x-device-token": "  ", authorization: `Bearer ${TOKEN}` });
    expect(tokenFrom(h)).toBe(TOKEN);
    expect(tokenFrom(new Headers({ "x-device-token": TOKEN }))).toBe(TOKEN);
    expect(tokenFrom(new Headers())).toBe("");
    expect((await handleNotify(h, body(), "x")).status).toBe(200);
  });
});
