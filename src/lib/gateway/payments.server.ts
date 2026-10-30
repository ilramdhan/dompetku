/**
 * v25 invoice payment gateway (issue #97): `gateway_transactions` rows, the public "Bayar
 * sekarang" order, webhook/status sync with booking, and admin refunds. Pure rules live in
 * ./types.ts and ./midtrans.ts; Midtrans HTTP in ./midtrans.server.ts.
 *
 * Trust model
 * - The webhook body is only a hint: after the signature check the order is looked up locally and
 *   its status + gross amount are ALWAYS re-read from the Midtrans Get Status API.
 * - The verified gross amount must equal the stored row (set by us from the server-computed
 *   remaining amount) or nothing is booked.
 * - Booking is claimed with a conditional update (`payment_id is null and claimed_at is null`), so
 *   two concurrent webhooks / a webhook + "Cek status" can never book twice. A crash between the
 *   claim and linking the payment is recovered by looking up the payment by its reference (the
 *   Midtrans transaction id) before booking again.
 * - Refunds never delete anything: each refund is a reversing expense in category "Invoice"
 *   (`external_id = invoice_refund:<row id>:<refund key>`) and `invoice_payments.refunded`, so the
 *   invoice's net `paid` and derived status follow through `syncInvoice`.
 */
import { randomBytes } from "crypto";
import { db } from "../db.server";
import { INVOICE_CATEGORY } from "../invoices";
import { snapJsUrl } from "./midtrans";
import { midtrans, midtransConfig } from "./midtrans.server";
import {
  DEAD_STATES,
  PAID_STATES,
  amountsMatch,
  cappedRefund,
  gatewayAmount,
  gatewayAvailable,
  isGatewayStatus,
  makeOrderId,
  nextStatus,
  refundExternalId,
  refundKey,
  refundProblem,
  reusablePending,
  type GatewayConfig,
  type GatewayState,
  type GatewayStatus,
  type RefundEntry,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const V25_MISSING =
  "Payment gateway belum aktif: jalankan bagian v25 di supabase/schema.sql.";
/** Uniform public errors (no oracle about tokens, invoices or configuration). */
export const PAY_UNAVAILABLE = "Pembayaran online tidak tersedia untuk invoice ini.";
export const PAY_RATE_LIMITED = "Terlalu banyak percobaan, coba lagi nanti.";
export const PAY_FAILED = "Pembayaran online gagal dibuat, coba lagi.";

/** Snap order lifetime (minutes); a pending order is reused while > 10 min remain. */
const ORDER_EXPIRY_MIN = 24 * 60;
/** A claim older than this without a payment is considered abandoned (crash) and retried. */
const STALE_CLAIM_MS = 10 * 60_000;

const fin = () => import("../finance.server");

export type GatewayRow = {
  id: string;
  invoice_id: string;
  provider: string;
  order_id: string;
  gateway_tx_id: string | null;
  status: GatewayStatus;
  gross_amount: number;
  refunded_amount: number;
  payment_type: string | null;
  payment_id: string | null;
  snap_token: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  claimed_at: string | null;
  last_error: string | null;
  raw: any;
  created_at: string;
  updated_at: string;
};

const rowOf = (r: any): GatewayRow => ({
  ...r,
  status: isGatewayStatus(r.status) ? r.status : "pending",
  gross_amount: Number(r.gross_amount),
  refunded_amount: Number(r.refunded_amount ?? 0),
});

const table = () => (db() as any).from("gateway_transactions");

async function missing(err: { message?: string; code?: string } | null | undefined) {
  return (await fin()).isMissingTable(err);
}

/**
 * v25 present? (any error = not ready). A plain one-row select, not `head: true`: a HEAD request
 * to a missing table gets an empty 404 body, which postgrest-js reports as `error: null`.
 */
export async function gatewayReady(): Promise<boolean> {
  try {
    const res = await table().select("id").limit(1);
    return !res.error;
  } catch {
    return false;
  }
}

/* ---------------- public page ---------------- */

/** `{ available }` for the public page: v25 + configured + not demo + open + whole-rupiah amount. */
export async function publicGatewayFor(
  status: string,
  remaining: number,
  demo: boolean,
): Promise<{ available: boolean }> {
  try {
    if (demo) return { available: false };
    const c = await midtransConfig();
    if (!c) return { available: false };
    const ready = await gatewayReady();
    return { available: gatewayAvailable({ ready, configured: true, demo, status, remaining }) };
  } catch {
    return { available: false };
  }
}

export type PublicPayStart = {
  token: string;
  redirect_url: string;
  client_key: string | null;
  /** snap.js URL (fixed Midtrans host) or null → use redirect_url. */
  snap_js: string | null;
};

/**
 * Public "Bayar sekarang": rate limit (IP, token) → hashed token lookup → amount = remaining
 * (server) → reuse a live pending order with the same amount, else create a Snap order.
 * Throws only PAY_* messages.
 */
export async function startGatewayPayment(
  rawToken: unknown,
  ip: string,
  siteOrigin: string | null,
): Promise<PublicPayStart> {
  const { activeShareInvoiceId, hashShareToken } = await import("../invoice-share.server");
  const { normalizeShareToken } = await import("../invoice-share");
  const { rateHit, subjectHash } = await import("../rate-limit.server");
  const { GATEWAY_RATE_RULES } = await import("../rate-limit");
  const { remainingOf } = await import("../invoices");

  if (!(await rateHit(GATEWAY_RATE_RULES.ip, subjectHash(`ip:${ip}`))))
    throw new Error(PAY_RATE_LIMITED);
  const token = normalizeShareToken(rawToken);
  if (!token) throw new Error(PAY_UNAVAILABLE);
  if (!(await rateHit(GATEWAY_RATE_RULES.token, subjectHash(`token:${hashShareToken(token)}`))))
    throw new Error(PAY_RATE_LIMITED);

  const invoiceId = await activeShareInvoiceId(token);
  if (!invoiceId) throw new Error(PAY_UNAVAILABLE);
  const c = await midtransConfig();
  if (!c) throw new Error(PAY_UNAVAILABLE);
  const s = await import("../invoices.server");
  const inv = await s.loadInvoice(invoiceId);
  if (!inv || (inv.status !== "unpaid" && inv.status !== "partial"))
    throw new Error(PAY_UNAVAILABLE);
  const amount = gatewayAmount(remainingOf(inv.total, inv.paid));
  if (amount === null) throw new Error(PAY_UNAVAILABLE);

  const answer = (r: { snap_token: string; redirect_url: string }): PublicPayStart => ({
    token: r.snap_token,
    redirect_url: r.redirect_url,
    client_key: c.clientKey,
    snap_js: c.clientKey && !c.overridden ? snapJsUrl(c.production) : null,
  });

  const open = await table()
    .select("*")
    .eq("invoice_id", inv.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (open.error) {
    if (await missing(open.error)) throw new Error(PAY_UNAVAILABLE);
    throw new Error(PAY_FAILED);
  }
  const now = new Date();
  const reuse = ((open.data ?? []) as any[])
    .map(rowOf)
    .find((r) => reusablePending(r, amount, now));
  if (reuse) return answer(reuse as { snap_token: string; redirect_url: string });

  const orderId = makeOrderId(inv.number, randomBytes(6).toString("hex"));
  const ins = await table()
    .insert({ invoice_id: inv.id, provider: "midtrans", order_id: orderId, gross_amount: amount })
    .select("id")
    .single();
  if (ins.error) {
    (await import("../monitoring.server")).logError("gateway:insert", ins.error);
    throw new Error(PAY_FAILED);
  }
  try {
    const finishUrl = siteOrigin ? `${siteOrigin}/i/${token}?gw=1` : null;
    const r = await midtrans.createPayment(c, {
      orderId,
      amount,
      invoiceNumber: inv.number,
      customerName: inv.customer_name,
      customerEmail: inv.customer_email,
      customerPhone: inv.customer_phone,
      finishUrl,
      expiryMinutes: ORDER_EXPIRY_MIN,
    });
    const expires = new Date(now.getTime() + ORDER_EXPIRY_MIN * 60_000).toISOString();
    await table()
      .update({
        snap_token: r.token,
        redirect_url: r.redirectUrl,
        expires_at: expires,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ins.data.id);
    await (
      await fin()
    ).logActivity("invoices.gateway_create", "invoices", {
      name: `${inv.number} · ${inv.customer_name}`,
      amount,
      currency: "IDR",
    });
    return answer({ snap_token: r.token, redirect_url: r.redirectUrl });
  } catch (e) {
    await table()
      .update({
        status: "failed",
        last_error: (e instanceof Error ? e.message : "error").slice(0, 300),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ins.data.id)
      .eq("status", "pending");
    (await import("../monitoring.server")).logError("gateway:create", e);
    throw new Error(PAY_FAILED);
  }
}

/* ---------------- sync (webhook / "Cek status") ---------------- */

export async function loadGatewayRow(by: { id?: string; order_id?: string }) {
  let q = table().select("*");
  q = by.id ? q.eq("id", by.id) : q.eq("order_id", by.order_id ?? "");
  const res = await q.maybeSingle();
  if (res.error) {
    if (await missing(res.error)) throw new Error(V25_MISSING);
    throw new Error(res.error.message);
  }
  return res.data ? rowOf(res.data) : null;
}

export type SyncResult = {
  row: GatewayRow;
  booked: boolean;
  refunded: number;
  note: string | null;
};

/** Business reasons a verified payment cannot be booked now: shown in last_error; the next sync retries. */
const KEEP_ERRORS = new Set([
  "Invoice ini tidak bisa menerima pembayaran",
  "Pembayaran melebihi sisa tagihan",
  "Pilih dompet penerima",
]);

/** Applies a verified provider state to a stored row (transition → book → refunds). */
export async function applyState(row: GatewayRow, state: GatewayState): Promise<SyncResult> {
  if (!amountsMatch(state.grossAmount, row.gross_amount)) {
    const note = "Jumlah dari Midtrans tidak cocok dengan pesanan";
    await table()
      .update({ last_error: note, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("payment_id", null);
    (await import("../monitoring.server")).logError(
      "gateway:amount-mismatch",
      new Error(`order ${row.order_id}`),
    );
    return { row: { ...row, last_error: note }, booked: false, refunded: 0, note };
  }
  // A chargeback without refund entries cannot be booked as a reversing expense: keep the status
  // (so the ledger and the invoice still agree) and flag it for a manual check.
  if (/chargeback/.test(state.providerStatus) && !state.refunds.length) {
    const note = "Chargeback dari Midtrans, cek manual";
    await table()
      .update({ last_error: note, raw: state.raw, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { row: { ...row, last_error: note }, booked: false, refunded: 0, note };
  }
  const next = nextStatus(row.status, state.status);
  const patch: Record<string, unknown> = {
    status: next,
    payment_type: state.paymentType ?? row.payment_type,
    raw: state.raw,
    updated_at: new Date().toISOString(),
  };
  if (!row.gateway_tx_id && state.gatewayTxId) patch["gateway_tx_id"] = state.gatewayTxId;
  // Conditional on the status we read, so a concurrent sync with a newer status is not undone.
  const upd = await table()
    .update(patch)
    .eq("id", row.id)
    .eq("status", row.status)
    .select("*")
    .maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
  let current = upd.data ? rowOf(upd.data) : await loadGatewayRow({ id: row.id });
  if (!current) throw new Error("Transaksi gateway tidak ditemukan");
  if (!upd.data) {
    // Lost the race: re-apply the transition on the fresher row (machine is monotonic).
    const again = nextStatus(current.status, state.status);
    if (again !== current.status) return applyState(current, state);
  }

  let booked = false;
  if (PAID_STATES.includes(current.status) && !current.payment_id) {
    const b = await bookOnce(current, state);
    booked = b.booked;
    current = b.row;
  }
  let refunded = 0;
  if (current.payment_id && state.refunds.length) {
    refunded = await applyRefunds(current, state.refunds);
    if (refunded) current = (await loadGatewayRow({ id: row.id })) ?? current;
  }
  return { row: current, booked, refunded, note: current.last_error };
}

/**
 * Books a paid row exactly once.
 *
 * Claim protocol (all conditional updates, so concurrent webhooks / "Cek status" race safely):
 * 1. Only a STALE claim (older than STALE_CLAIM_MS, i.e. a crash mid-booking) is released, and
 *    only by the request that still sees that exact `claimed_at` value.
 * 2. The claim itself is one atomic update `claimed_at = now, last_error = null` where
 *    `payment_id is null and claimed_at is null`; whoever does not get the row returns.
 * 3. On any booking failure the claim is released at the end of THIS attempt (conditional on our
 *    own `claimed_at`), so a business error (invoice paid/cancelled meanwhile) never parks the
 *    claim; the next sync retries safely because bookPayment re-checks the remaining amount.
 * 4. `last_error` is only written while `payment_id is null`, and the final link only when
 *    `payment_id is null` too.
 */
async function bookOnce(row: GatewayRow, state: GatewayState) {
  const now = Date.now();
  if (row.claimed_at && now - Date.parse(row.claimed_at) > STALE_CLAIM_MS)
    await table()
      .update({ claimed_at: null })
      .eq("id", row.id)
      .eq("claimed_at", row.claimed_at)
      .is("payment_id", null);
  const mine = new Date(now).toISOString();
  const claim = await table()
    .update({ claimed_at: mine, last_error: null })
    .eq("id", row.id)
    .is("payment_id", null)
    .is("claimed_at", null)
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) return { booked: false, row: (await loadGatewayRow({ id: row.id })) ?? row };

  const release = (patch: Record<string, unknown> = {}) =>
    table()
      .update({ claimed_at: null, ...patch })
      .eq("id", row.id)
      .eq("claimed_at", mine)
      .is("payment_id", null);

  const s = await import("../invoices.server");
  const txRef = (state.gatewayTxId ?? row.order_id).slice(0, 120);
  // Crash recovery: a payment already booked for this order (under the Midtrans transaction id or,
  // when that was unknown at the time, the order id) is linked, not re-booked.
  const refs = [...new Set([txRef, row.order_id, row.gateway_tx_id].filter(Boolean))] as string[];
  const prior = await db()
    .from("invoice_payments")
    .select("id")
    .eq("invoice_id", row.invoice_id)
    .in("reference", refs)
    .limit(1);
  if (prior.error) {
    await release();
    throw new Error(prior.error.message);
  }
  let paymentId: string | null = prior.data?.[0]?.id ?? null;
  let booked = false;
  if (!paymentId) {
    const inv = await s.loadInvoice(row.invoice_id);
    try {
      if (!inv) throw new Error("Invoice ini tidak bisa menerima pembayaran");
      const res = await s.bookPayment(inv, {
        amount: row.gross_amount,
        paid_at: null,
        method: `Midtrans${state.paymentType ? ` (${state.paymentType})` : ""}`.slice(0, 40),
        reference: txRef,
        note: `Midtrans order ${row.order_id}`.slice(0, 500),
      });
      paymentId = res.paymentId;
      booked = true;
      await (
        await import("../invoice-email.server")
      ).sendPaymentConfirmation(res.invoice, row.gross_amount);
      await (
        await fin()
      ).logActivity("invoices.gateway", "invoices", {
        name: `${inv.number} · ${inv.customer_name}`,
        amount: row.gross_amount,
        currency: "IDR",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      // Money arrived but cannot be booked now (e.g. invoice paid/cancelled meanwhile): show it to
      // the admin (refund or record by hand) and release the claim so a later sync may retry.
      await release(
        KEEP_ERRORS.has(msg)
          ? { last_error: msg.slice(0, 300), updated_at: new Date().toISOString() }
          : {},
      );
      if (KEEP_ERRORS.has(msg))
        return { booked: false, row: (await loadGatewayRow({ id: row.id })) ?? row };
      throw e;
    }
  }
  await table()
    .update({ payment_id: paymentId, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("payment_id", null);
  return { booked, row: (await loadGatewayRow({ id: row.id })) ?? row };
}

/**
 * Books each refund once as a reversing expense (idempotent external id) and stores the refunded
 * totals on the gateway row and the payment, then recomputes the invoice. Returns the amount of
 * newly booked refunds.
 */
async function applyRefunds(row: GatewayRow, refunds: readonly RefundEntry[]): Promise<number> {
  const s = await import("../invoices.server");
  const f = await fin();
  const inv = await s.loadInvoice(row.invoice_id);
  if (!inv) return 0;
  const pay = await s.loadPayment(row.payment_id!);
  if (!pay) return 0;
  let fresh = 0;
  for (const r of refunds) {
    if (!(r.amount > 0)) continue;
    const res = await f.createFromExternal(
      {
        kind: "expense",
        amount: r.amount,
        currency: "IDR",
        category: INVOICE_CATEGORY,
        account: null,
        to_account: null,
        description: `Refund invoice ${inv.number} · ${inv.customer_name}`,
        merchant: null,
        date: f.today(),
        source: "web",
        items: null,
        notes: `Midtrans refund ${r.key} · order ${row.order_id}`,
        external_id: refundExternalId(row.id, r.key),
        receipt_path: null,
        pocket: null,
      },
      inv.account_id ? { account_id: inv.account_id } : undefined,
    );
    if (!res.duplicate) fresh += r.amount;
  }
  // Only refunds that were booked as expenses count, so the invoice and the ledger always agree.
  const refunded = cappedRefund(
    pay.amount,
    refunds.reduce((sum, r) => sum + (r.amount > 0 ? r.amount : 0), 0),
  );
  await table()
    .update({ refunded_amount: refunded, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  const up = await (db() as any).from("invoice_payments").update({ refunded }).eq("id", pay.id);
  if (up.error) throw new Error(up.error.message);
  await s.syncInvoice(inv.id);
  if (fresh > 0)
    await f.logActivity("invoices.gateway_refund", "invoices", {
      name: `${inv.number} · ${inv.customer_name}`,
      amount: fresh,
      currency: "IDR",
    });
  return fresh;
}

/** Re-reads one order from Midtrans and applies it. null state = Midtrans does not know it yet. */
export async function syncRow(c: GatewayConfig, row: GatewayRow): Promise<SyncResult> {
  const state = await midtrans.fetchStatus(c, row.order_id);
  if (!state) return { row, booked: false, refunded: 0, note: null };
  return applyState(row, state);
}

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

/**
 * Midtrans notification. Order of checks: configured → v25 → signature (constant time) → known
 * order → re-read status from the API → amount → transition/booking. Answers 200 for anything
 * processed or ignorable so Midtrans stops retrying; 503 for transient failures (Midtrans retries).
 */
export async function handleMidtransWebhook(body: unknown): Promise<WebhookOutcome> {
  const c = await midtransConfig();
  if (!c) return { status: 503, body: { ok: false } };
  const check = midtrans.verifyWebhook(c, body);
  if (!check.ok) return { status: check.status, body: { ok: false } };
  if (!(await gatewayReady())) return { status: 503, body: { ok: false } };
  const row = await loadGatewayRow({ order_id: check.orderId });
  // Not ours (e.g. another app on the same Midtrans account): acknowledge, nothing to do.
  if (!row) return { status: 200, body: { ok: true, ignored: true } };
  try {
    const r = await syncRow(c, row);
    return { status: 200, body: { ok: true, status: r.row.status } };
  } catch (e) {
    (await import("../monitoring.server")).logError("gateway:webhook", e);
    return { status: 503, body: { ok: false } };
  }
}

/* ---------------- admin ---------------- */

/** Gateway rows of one invoice for the detail view ({ ready:false } before v25). */
export async function listGatewayTransactions(invoiceId: string) {
  const res = await table()
    .select(
      "id, order_id, gateway_tx_id, status, gross_amount, refunded_amount, payment_type, payment_id, last_error, created_at, updated_at",
    )
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (res.error) {
    if (await missing(res.error)) return { ready: false as const, items: [] };
    throw new Error(res.error.message);
  }
  const c = await midtransConfig().catch(() => null);
  return {
    ready: true as const,
    configured: !!c,
    items: ((res.data ?? []) as any[]).map((r) => ({
      ...r,
      gross_amount: Number(r.gross_amount),
      refunded_amount: Number(r.refunded_amount ?? 0),
    })),
  };
}

export async function requireConfig(): Promise<GatewayConfig> {
  const c = await midtransConfig();
  if (!c) throw new Error("Midtrans belum diaktifkan di Pengaturan → Integrasi");
  return c;
}

/**
 * Admin refund through the Midtrans API. Re-reads the order first (must be settlement and
 * refundable), sends a deterministic refund_key (retries/double clicks reuse it), then books the
 * reversing expense from the verified state.
 */
export async function refundGateway(row: GatewayRow, amount: number, reason: string) {
  const c = await requireConfig();
  const state = await midtrans.fetchStatus(c, row.order_id);
  if (!state) throw new Error("Transaksi tidak ditemukan di Midtrans");
  const synced = await applyState(row, state);
  const cur = synced.row;
  if (!cur.payment_id) throw new Error("Pembayaran belum tercatat; cek status dulu");
  const problem = refundProblem(
    { ...cur, provider_status: state.providerStatus },
    Math.round(amount * 100) / 100,
  );
  if (problem) throw new Error(problem);
  const key = refundKey(cur.id, state.refunds.length + 1);
  const r = await midtrans.refund(c, cur.order_id, { key, amount, reason: reason || "Refund" });
  if (!r.ok) throw new Error(r.error);
  const after = await midtrans.fetchStatus(c, cur.order_id);
  // The status API may lag a moment: book from our own accepted request when the refund is not
  // listed yet; the same key later dedupes it.
  const listed = after?.refunds.some((x) => x.key === key);
  const fallback: GatewayState = {
    ...(after ?? state),
    status: nextStatus(
      cur.status,
      amountsMatch(amount + cur.refunded_amount, cur.gross_amount) ? "refunded" : "partial_refund",
    ),
    refunds: listed
      ? (after?.refunds ?? [])
      : [...(after?.refunds ?? state.refunds), { key, amount, at: null }],
    refundedAmount: listed
      ? (after?.refundedAmount ?? 0)
      : Math.max(after?.refundedAmount ?? 0, cur.refunded_amount + amount),
  };
  const done = await applyState(cur, fallback);
  return done.row;
}

/**
 * Before deleting an invoice: refuse while any gateway row is not failed/expired (money was or may
 * be received); delete the dead ones so the FK (on delete restrict) lets the invoice go.
 * No-op before v25.
 */
export async function releaseInvoiceGateway(invoiceId: string) {
  const res = await table().select("id, status").eq("invoice_id", invoiceId);
  if (res.error) return;
  const rows = (res.data ?? []) as { id: string; status: GatewayStatus }[];
  if (rows.some((r) => !DEAD_STATES.includes(r.status)))
    throw new Error(
      "Invoice punya transaksi Midtrans yang tertunda atau berhasil; tidak bisa dihapus (batalkan saja)",
    );
  if (rows.length) await table().delete().eq("invoice_id", invoiceId);
}

/** Payments booked from the gateway cannot be deleted by hand (refund them instead). */
export async function assertPaymentNotGateway(paymentId: string) {
  const res = await table().select("id").eq("payment_id", paymentId).limit(1);
  if (res.error) return;
  if (res.data?.length)
    throw new Error("Pembayaran dari Midtrans tidak bisa dihapus; gunakan refund");
}
