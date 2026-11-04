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
import { FEE_CATEGORY } from "../fees";
import { mdrExternalId, mdrFee } from "./mdr";
import { snapJsUrl } from "./midtrans";
import { midtrans, midtransConfig } from "./midtrans.server";
import {
  DEAD_STATES,
  PAID_STATES,
  GATEWAY_MIN_PARTIAL,
  amountsMatch,
  cappedRefund,
  chargeAmount,
  duplicateRefundOk,
  gatewayAmount,
  gatewayAvailable,
  isGatewayStatus,
  makeOrderId,
  nextRefundSeq,
  nextStatus,
  ORDER_EXPIRY_MIN,
  partialAllowed,
  pendingAgedOut,
  startWinner,
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

/** Losers of a concurrent start poll the winner's row this often, this many times (~5 s). */
const WINNER_WAIT_MS = 250;
const WINNER_WAIT_STEPS = 20;
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

/**
 * Invoices on refund hold (a gateway refund was booked and the admin has not re-billed yet).
 * Empty before v25 or on error (reminders/pay button then behave as before v25).
 */
export async function refundHeldInvoices(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  try {
    const res = await table()
      .select("invoice_id")
      .eq("refund_hold", true)
      .in("invoice_id", [...ids]);
    if (res.error) return new Set();
    return new Set(((res.data ?? []) as { invoice_id: string }[]).map((r) => r.invoice_id));
  } catch {
    return new Set();
  }
}

/**
 * Strict refund-hold check for booking paths: false only when the invoice is not held or v25 is
 * not installed (missing table/column); any other DB error throws, so callers can fail closed.
 */
export async function refundHoldStrict(invoiceId: string): Promise<boolean> {
  const res = await table()
    .select("invoice_id")
    .eq("refund_hold", true)
    .eq("invoice_id", invoiceId)
    .limit(1);
  if (res.error) {
    const e = res.error as { message?: string; code?: string };
    if (
      (await missing(e)) ||
      /42703|PGRST204|refund_hold/i.test(`${e.code ?? ""} ${e.message ?? ""}`)
    )
      return false;
    throw new Error(e.message ?? "refund hold check failed");
  }
  return ((res.data ?? []) as unknown[]).length > 0;
}

/** "Tagih ulang": lifts the refund hold of an invoice (pay button and reminders come back). */
export async function releaseRefundHold(invoiceId: string) {
  const res = await table()
    .update({ refund_hold: false, updated_at: new Date().toISOString() })
    .eq("invoice_id", invoiceId)
    .eq("refund_hold", true);
  if (res.error) {
    if (await missing(res.error)) throw new Error(V25_MISSING);
    throw new Error(res.error.message);
  }
  return { ok: true };
}

/* ---------------- public page ---------------- */

/** `{ available }` for the public page: v25 + configured + not demo + open + whole-rupiah amount + no refund hold. */
export async function publicGatewayFor(
  invoiceId: string,
  status: string,
  remaining: number,
  demo: boolean,
): Promise<{ available: boolean; partial: boolean; min: number | null }> {
  const off = { available: false, partial: false, min: null };
  try {
    if (demo) return off;
    const c = await midtransConfig();
    if (!c) return off;
    const ready = await gatewayReady();
    if (ready && (await refundHeldInvoices([invoiceId])).has(invoiceId)) return off;
    const available = gatewayAvailable({ ready, configured: true, demo, status, remaining });
    if (!available) return off;
    // #124: partial amounts only when enabled and the remaining amount fits two minimum payments
    // (a partial must leave at least GATEWAY_MIN_PARTIAL unpaid, see chargeAmount).
    const partial = !!c.partial && partialAllowed(remaining);
    return { available, partial, min: partial ? GATEWAY_MIN_PARTIAL : null };
  } catch {
    return off;
  }
}

export type PublicPayStart = {
  token: string;
  redirect_url: string;
  client_key: string | null;
  /** snap.js URL (fixed Midtrans host) or null → use redirect_url. */
  snap_js: string | null;
  /** Test-only base override active: the browser may follow a non-Midtrans redirect_url. */
  test_redirect: boolean;
};

/** A concurrent start still creating its Snap order (tokenless and young). */
const inFlight = (r: GatewayRow, now: Date) => startWinner([r], now) === r.id;

/** a sorts before b by (created_at, id), the order `startWinner` uses. */
function orderedBefore(a: GatewayRow, b: GatewayRow): boolean {
  const ta = Date.parse(a.created_at ?? "");
  const tb = Date.parse(b.created_at ?? "");
  if (ta !== tb) return ta < tb;
  return a.id < b.id;
}

/** Wait briefly for the winning concurrent start to save its Snap token (same amount only). */
async function awaitWinnerToken(
  id: string,
): Promise<{ snap_token: string; redirect_url: string } | null> {
  for (let i = 0; i < WINNER_WAIT_STEPS; i++) {
    await new Promise((r) => setTimeout(r, WINNER_WAIT_MS));
    const r = await table().select("status, snap_token, redirect_url").eq("id", id).maybeSingle();
    if (r.error || !r.data || r.data.status !== "pending") return null;
    if (r.data.snap_token && r.data.redirect_url)
      return { snap_token: r.data.snap_token, redirect_url: r.data.redirect_url };
  }
  return null;
}

/**
 * Public "Bayar sekarang": rate limit (IP, token) → hashed token lookup → amount = remaining
 * (server) or, with MIDTRANS_PARTIAL (#124), a requested whole-rupiah amount between the minimum
 * and the remaining amount (`chargeAmount`, re-checked server-side) → reuse a live pending order
 * with the same amount, else create a Snap order (other pending amounts are expired first, so one
 * live amount per invoice). Throws only PAY_* messages.
 */
export async function startGatewayPayment(
  rawToken: unknown,
  ip: string,
  siteOrigin: string | null,
  requested: number | null = null,
): Promise<PublicPayStart> {
  const { activeShareInvoiceId, hashShareToken } = await import("../invoice-share.server");
  const { normalizeShareToken } = await import("../invoice-share");
  const { rateHit, subjectHash } = await import("../rate-limit.server");
  const { GATEWAY_RATE_RULES } = await import("../rate-limit");
  const { remainingOf } = await import("../invoices");

  const { ipRateSubject } = await import("../client-ip.server");
  const ipKey = ipRateSubject(ip);
  // No known address: skip the per-IP rule (one shared bucket would let one client block all);
  // the per-token rule below still applies.
  if (ipKey !== null && !(await rateHit(GATEWAY_RATE_RULES.ip, subjectHash(`ip:${ipKey}`))))
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
  if ((await refundHeldInvoices([inv.id])).has(inv.id)) throw new Error(PAY_UNAVAILABLE);
  const amount = chargeAmount(remainingOf(inv.total, inv.paid), requested, !!c.partial);
  if (amount === null) throw new Error(PAY_UNAVAILABLE);

  const answer = (r: { snap_token: string; redirect_url: string }): PublicPayStart => ({
    token: r.snap_token,
    redirect_url: r.redirect_url,
    client_key: c.clientKey,
    snap_js: c.clientKey && !c.overridden ? snapJsUrl(c.production) : null,
    test_redirect: c.overridden,
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
  // Pending orders for another amount (the remaining amount changed) are expired first; when one
  // cannot be expired at Midtrans it stays pending and no second amount is handed out (L1).
  // In-flight starts of concurrent requests (tokenless, young) are left to the winner rule below.
  if ((await retirePendingOrders(inv.id, { amount, skip: (r) => inFlight(r, now) })) > 0)
    throw new Error(PAY_FAILED);
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
  // Serialize per invoice without a schema change (review L1 + E2E of #124). Among concurrent
  // in-flight starts the earliest by (created_at, id) wins (`startWinner`); losers retire nobody
  // and step aside (a loser asking for the same amount hands out the winner's token once it is
  // saved, so a double click still opens Snap). The winner retires every other pending order
  // except in-flight ones that sort before it; if one survives (Midtrans expire failed), its own
  // row was retired, or a fresh read no longer names it the winner, it gives up before any Snap
  // order exists. The earliest in-flight row is never retired by anyone, so one start succeeds.
  const myId = ins.data.id as string;
  const lose = async () => {
    await table()
      .update({
        status: "failed",
        last_error: "Digantikan order lain yang dibuat bersamaan",
        updated_at: new Date().toISOString(),
      })
      .eq("id", myId)
      .in("status", ["pending", "expired"]);
  };
  const winnerNow = async () => {
    const r = await table().select("*").eq("invoice_id", inv.id).eq("status", "pending");
    if (r.error) return null;
    const rows = ((r.data ?? []) as any[]).map(rowOf);
    return { rows, id: startWinner(rows, new Date()) };
  };
  const first = await winnerNow();
  if (!first) {
    await lose();
    throw new Error(PAY_FAILED);
  }
  if (first.id !== myId) {
    await lose();
    const w = first.rows.find((r) => r.id === first.id);
    if (w && amountsMatch(w.gross_amount, amount)) {
      const token = await awaitWinnerToken(w.id);
      if (token) return answer(token);
    }
    throw new Error(PAY_FAILED);
  }
  const me = first.rows.find((r) => r.id === myId)!;
  // Younger in-flight starts have no Snap order yet: retire them locally (conditional on still
  // tokenless), never through Midtrans, whose expire would 404 and make them look payable. If
  // one creates its Snap order anyway, its own save misses and expires that order.
  const behind = first.rows
    .filter((r) => r.id !== myId && inFlight(r, now) && orderedBefore(me, r))
    .map((r) => r.id);
  if (behind.length)
    await table()
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("id", behind)
      .eq("status", "pending")
      .is("snap_token", null);
  const ahead = (r: GatewayRow) => inFlight(r, new Date()) && orderedBefore(r, me);
  const left = await retirePendingOrders(inv.id, { amount: null, except: myId, skip: ahead });
  const again = await winnerNow();
  if (left > 0 || !again || again.id !== myId) {
    await lose();
    throw new Error(PAY_FAILED);
  }
  let settled = false;
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
    const saved = await table()
      .update({
        snap_token: r.token,
        redirect_url: r.redirectUrl,
        expires_at: expires,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ins.data.id)
      .eq("status", "pending")
      .select("id");
    if (saved.error || !saved.data?.length) {
      // Retired by a concurrent request while the Snap order was being created, or the token
      // could not be saved (review L5: never hand out a token the row does not know): expire the
      // new order; if that fails, put the row back to pending with its token and expiry (so
      // `pendingAgedOut` only ages it out after the Snap expiry) and the next retire retries it.
      if (saved.error) (await import("../monitoring.server")).logError("gateway:save", saved.error);
      if (!(await midtrans.expire(c, orderId)))
        await table()
          .update({
            status: "pending",
            snap_token: r.token,
            redirect_url: r.redirectUrl,
            expires_at: expires,
            updated_at: new Date().toISOString(),
          })
          .eq("id", ins.data.id)
          .in("status", ["pending", "expired"]);
      else
        await table()
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", ins.data.id)
          .eq("status", "pending");
      settled = true; // the row is already in its final state: the catch must not mark it failed
      throw new Error(PAY_FAILED);
    }
    await (
      await fin()
    ).logActivity("invoices.gateway_create", "invoices", {
      name: `${inv.number} · ${inv.customer_name}`,
      amount,
      currency: "IDR",
    });
    return answer({ snap_token: r.token, redirect_url: r.redirectUrl });
  } catch (e) {
    if (settled) throw e;
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

/**
 * What to do with a pending order Midtrans refused to expire (review M1/I6 of #124), from Get
 * Status: paid → "paid" (the caller books it through the normal claim path); failed/expired →
 * "dead"; unknown (404) → "dead" only when the row has aged out (`pendingAgedOut`: tokenless, or
 * past its Snap expiry + grace), else "live" (the Snap token may still be used); a Midtrans
 * pending transaction or an error → "live" (blocks new orders, never loses a payment).
 */
async function refusedExpire(
  c: GatewayConfig,
  row: GatewayRow,
  now: Date,
): Promise<{ kind: "dead" | "live" } | { kind: "paid"; state: GatewayState }> {
  try {
    const st = await midtrans.fetchStatus(c, row.order_id);
    if (!st) return { kind: pendingAgedOut(row, now) ? "dead" : "live" };
    if (DEAD_STATES.includes(st.status)) return { kind: "dead" };
    if (PAID_STATES.includes(st.status)) return { kind: "paid", state: st };
    return { kind: "live" };
  } catch {
    return { kind: "live" };
  }
}

/**
 * Retires pending orders of an invoice that must not be paid any more (amount no longer equals
 * the remaining amount, or the invoice is paid/cancelled/draft; `amount: null` = every pending
 * order except `except`): Midtrans `POST /v2/{order}/expire`, and only when Midtrans confirms (or
 * the gateway is off) the local row becomes `expired` (conditional on still pending). When the
 * expire is refused, Get Status decides (`refusedExpire`): a dead or aged-out order is expired
 * locally (M1), a paid one is synced and booked through `applyState` (the atomic claim, I6), and
 * a possibly payable one stays `pending` so the next call retries it (L1). If a customer still
 * pays a retired order, the verified settlement moves it to success (`nextStatus`) and is booked
 * or flagged as usual. Returns how many orders block a new order now: still live, or just booked
 * (the remaining amount changed), 1 on an unexpected error. Never throws; no-op before v25.
 */
export async function retirePendingOrders(
  invoiceId: string,
  keep: {
    amount: number | null;
    except?: string | undefined;
    /** Keep these rows too (in-flight starts that win over the caller, see startWinner). */
    skip?: (r: GatewayRow) => boolean;
  },
): Promise<number> {
  try {
    const res = await table().select("*").eq("invoice_id", invoiceId).eq("status", "pending");
    if (res.error) return (await missing(res.error)) ? 0 : 1;
    if (!res.data?.length) return 0;
    const stale = (res.data as any[])
      .map(rowOf)
      .filter(
        (r) =>
          r.id !== keep.except &&
          !keep.skip?.(r) &&
          (keep.amount === null || !amountsMatch(r.gross_amount, keep.amount)),
      );
    if (!stale.length) return 0;
    const c = await midtransConfig().catch(() => null);
    const now = new Date();
    let blocking = 0;
    for (const r of stale) {
      if (c && !(await midtrans.expire(c, r.order_id))) {
        const v = await refusedExpire(c, r, now);
        if (v.kind === "paid") {
          blocking++;
          try {
            await applyState(r, v.state);
          } catch (e) {
            (await import("../monitoring.server")).logError("gateway:retire-sync", e, {
              order_id: r.order_id,
            });
          }
          continue;
        }
        if (v.kind === "live") {
          blocking++;
          (await import("../monitoring.server")).logError(
            "gateway:retire",
            new Error("Midtrans expire failed; order kept pending"),
            { order_id: r.order_id },
          );
          continue;
        }
      }
      await table()
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", "pending");
    }
    return blocking;
  } catch (e) {
    try {
      (await import("../monitoring.server")).logError("gateway:retire", e);
    } catch {
      /* ignore */
    }
    return 1;
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
  // #124: the MDR fee of this order, once (external id), before the row is linked so a crash in
  // between retries it on the next sync (the prior-payment path above). Never fails the booking.
  await bookMdr(row, state);
  await table()
    .update({ payment_id: paymentId, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("payment_id", null);
  return { booked, row: (await loadGatewayRow({ id: row.id })) ?? row };
}

/**
 * Books the Midtrans MDR of a paid order as an expense in category "Biaya Admin" on the invoice's
 * wallet, computed from MIDTRANS_FEES (Midtrans' status API has no fee field). Idempotent via
 * `external_id = invoice_mdr:<row id>`; refunds never reverse or repeat it. Runs only while the
 * row is being linked to its payment (never retroactively for rows booked earlier). Best effort:
 * errors are logged, the payment booking stands. Returns the fee newly booked (0 otherwise).
 */
export async function bookMdr(row: GatewayRow, state: GatewayState): Promise<number> {
  try {
    const c = await midtransConfig();
    const fee = mdrFee(c?.fees, state.paymentType ?? row.payment_type, row.gross_amount);
    if (!fee) return 0;
    const s = await import("../invoices.server");
    const inv = await s.loadInvoice(row.invoice_id);
    if (!inv?.account_id) return 0;
    const f = await fin();
    const type = state.paymentType ?? row.payment_type ?? "midtrans";
    const res = await f.createFromExternal(
      {
        kind: "expense",
        amount: fee,
        currency: "IDR",
        category: FEE_CATEGORY,
        account: null,
        to_account: null,
        description: `Biaya MDR Midtrans · ${inv.number}`.slice(0, 200),
        merchant: "Midtrans",
        date: f.today(),
        source: "web",
        items: null,
        notes: `Midtrans MDR ${type} · order ${row.order_id}`.slice(0, 500),
        external_id: mdrExternalId(row.id),
        receipt_path: null,
        pocket: null,
      },
      { account_id: inv.account_id },
    );
    return res.duplicate ? 0 : fee;
  } catch (e) {
    try {
      (await import("../monitoring.server")).logError("gateway:mdr", e);
    } catch {
      /* ignore */
    }
    return 0;
  }
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
    .update({
      refunded_amount: refunded,
      // A new refund puts the invoice on hold: no "Bayar sekarang", no due reminders, until the
      // admin re-bills it ("Tagih ulang").
      ...(fresh > 0 ? { refund_hold: true } : {}),
      updated_at: new Date().toISOString(),
    })
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

/** Unauthenticated noise only (bad payload / bad signature); signed requests are never limited. */
const BAD_WEBHOOK_RULES = [{ name: "midtrans:bad", limit: 300, windowMs: 3_600_000 }] as const;

/**
 * Midtrans notification. Order of checks: configured → signature (pure, constant time, no DB) →
 * v25 → known order → re-read status from the API → amount → transition/booking.
 * Only requests that FAIL the payload/signature check count against a per-IP limit (429 once
 * exceeded), so a spoofed X-Forwarded-For can never block genuine, signed notifications.
 * Answers 200 for anything processed or ignorable so Midtrans stops retrying; 503 for transient
 * failures (Midtrans retries).
 */
export async function handleMidtransWebhook(body: unknown, ip: string): Promise<WebhookOutcome> {
  const c = await midtransConfig();
  if (!c) return { status: 503, body: { ok: false } };
  const check = midtrans.verifyWebhook(c, body);
  if (!check.ok) {
    const { rateHit, subjectHash } = await import("../rate-limit.server");
    const { ipRateSubject } = await import("../client-ip.server");
    const ipKey = ipRateSubject(ip);
    const allowed =
      ipKey === null || (await rateHit(BAD_WEBHOOK_RULES, subjectHash(`ip:${ipKey}`)));
    return { status: allowed ? check.status : 429, body: { ok: false } };
  }
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
      "id, order_id, gateway_tx_id, status, gross_amount, refunded_amount, payment_type, payment_id, last_error, refund_hold, created_at, updated_at",
    )
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (res.error) {
    if (await missing(res.error)) return { ready: false as const, items: [] };
    throw new Error(res.error.message);
  }
  const c = await midtransConfig().catch(() => null);
  const rows = (res.data ?? []) as any[];
  // #124: booked MDR per row (by its idempotent external id); empty on any error.
  const mdr = new Map<string, number>();
  if (rows.length) {
    const ids = rows.map((r) => mdrExternalId(r.id));
    const tx = await db().from("transactions").select("external_id, amount").in("external_id", ids);
    if (!tx.error)
      for (const t of (tx.data ?? []) as { external_id: string | null; amount: number }[])
        if (t.external_id) mdr.set(t.external_id, Number(t.amount));
  }
  return {
    ready: true as const,
    configured: !!c,
    items: rows.map((r) => ({
      ...r,
      gross_amount: Number(r.gross_amount),
      refunded_amount: Number(r.refunded_amount ?? 0),
      mdr_amount: mdr.get(mdrExternalId(r.id)) ?? 0,
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
export async function refundGateway(row: GatewayRow, rawAmount: number, reason: string) {
  const c = await requireConfig();
  const amount = Math.round(rawAmount * 100) / 100;
  const state = await midtrans.fetchStatus(c, row.order_id);
  if (!state) throw new Error("Transaksi tidak ditemukan di Midtrans");
  const synced = await applyState(row, state);
  const cur = synced.row;
  if (!cur.payment_id) throw new Error("Pembayaran belum tercatat; cek status dulu");
  const problem = refundProblem({ ...cur, provider_status: state.providerStatus }, amount);
  if (problem) throw new Error(problem);
  const local = await db()
    .from("transactions")
    .select("external_id")
    .like("external_id", `${refundExternalId(cur.id, "")}%`);
  if (local.error) throw new Error(local.error.message);
  const seq = nextRefundSeq(
    cur.id,
    state.refunds.map((r) => r.key),
    ((local.data ?? []) as { external_id: string | null }[]).map((r) => r.external_id ?? ""),
  );
  const key = refundKey(cur.id, seq);
  const r = await midtrans.refund(c, cur.order_id, { key, amount, reason: reason || "Refund" });
  if (!r.ok) throw new Error(r.error);
  const after = await midtrans.fetchStatus(c, cur.order_id);
  const listed = after?.refunds.find((x) => x.key === key);
  if (r.duplicate) {
    // 406: this key was already used. Only accept it when Midtrans lists it with this amount.
    if (!after || !duplicateRefundOk(after.refunds, key, amount))
      throw new Error(
        "Refund dengan kunci ini sudah ada dengan jumlah berbeda; cek status lalu coba lagi",
      );
    return (await applyState(cur, after)).row;
  }
  // 200: the status API may lag a moment, so book from our own accepted request when the refund is
  // not listed yet; the same key dedupes it once Midtrans lists it.
  const base = after ?? state;
  const fallback: GatewayState = listed
    ? base
    : {
        ...base,
        status: nextStatus(
          cur.status,
          amountsMatch(amount + cur.refunded_amount, cur.gross_amount)
            ? "refunded"
            : "partial_refund",
        ),
        refunds: [...base.refunds, { key, amount, at: null }],
        refundedAmount: Math.max(base.refundedAmount, cur.refunded_amount + amount),
      };
  return (await applyState(cur, fallback)).row;
}

/**
 * Before deleting an invoice: refuse while any gateway row is not failed/expired (money was or may
 * be received); delete the dead ones so the FK (on delete restrict) lets the invoice go.
 * No-op before v25; any other DB error refuses the delete (fail closed).
 */
export async function releaseInvoiceGateway(invoiceId: string) {
  const res = await table().select("id, status").eq("invoice_id", invoiceId);
  if (res.error) {
    if (await missing(res.error)) return;
    throw new Error(res.error.message);
  }
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
  if (res.error) {
    if (await missing(res.error)) return;
    throw new Error(res.error.message);
  }
  if (res.data?.length)
    throw new Error("Pembayaran dari Midtrans tidak bisa dihapus; gunakan refund");
}
