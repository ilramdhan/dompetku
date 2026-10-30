/**
 * v21 Invoice core (issue #92): list/get/save/actions/delete plus manual payments. Pure math,
 * status rules, numbering and validation live in ./invoices.ts; this module only talks to the DB.
 *
 * - Totals are always recomputed from items here (client totals are never trusted).
 * - Numbers are `<PREFIX>-YYYYMM-####` (prefix from app_settings, default INV); a unique
 *   violation on insert retries with the next sequence.
 * - Each payment books one income transaction in category "Invoice" on the invoice wallet via
 *   `createFromExternal` with `external_id = invoice_pay:<payment id>` (idempotent); deleting the
 *   payment or the invoice deletes those transactions. `paid`/`status` are rewritten after every
 *   payment change (`syncInvoice`).
 * - Reads degrade to `{ ready: false }` before schema v21; writes throw a "run v21" message.
 * - Wallet scoping: callers pass `accountScope(ctx)` (null = owner, all wallets).
 */
import { db } from "./db.server";
import { fetchAll } from "./paginate";
import { scopeIds } from "./permissions";
import {
  INVOICE_CATEGORY,
  derivedStatus,
  displayStatus,
  editProblem,
  invoiceSummary,
  invoiceTotal,
  nextInvoiceNumber,
  paidSum,
  paymentExternalId,
  paymentProblem,
  remainingOf,
  validateInvoice,
  actionTarget,
  type InvoiceAction,
  type InvoiceFilter,
  type InvoiceItem,
  type InvoiceSort,
  type InvoiceStatus,
} from "./invoices";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Scope = readonly string[] | null | undefined;

export const V21_MISSING = "Fitur invoice belum aktif: jalankan bagian v21 di supabase/schema.sql.";

const fin = () => import("./finance.server");
const isDup = (e: { message?: string; code?: string } | null | undefined) =>
  /duplicate key|23505/i.test(`${e?.message ?? ""} ${e?.code ?? ""}`);

export type InvoiceRow = {
  id: string;
  number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  account_id: string | null;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  status: InvoiceStatus;
  currency: string;
  total: number;
  paid: number;
  created_at: string;
  updated_at: string;
};

export type InvoiceInput = {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  account_id: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  items: InvoiceItem[];
  /** Create only: save as draft (default) or issue right away (status unpaid). */
  issue?: boolean | undefined;
};

export type PaymentInput = {
  amount: number;
  paid_at: string | null;
  method: string;
  reference: string | null;
  note: string | null;
};

const num = (r: any): InvoiceRow => ({ ...r, total: Number(r.total), paid: Number(r.paid) });

/* ---------------- reads ---------------- */

export type ListOptions = {
  offset: number;
  limit: number;
  sort: InvoiceSort;
  direction: "asc" | "desc";
  status?: InvoiceFilter | undefined;
  account?: string | undefined;
  search?: string | undefined;
};

/** Restricts a query to the caller's wallets and the optional `?account=` filter. */
function scoped(q: any, scope: Scope, account?: string) {
  if (scope) q = q.in("account_id", scopeIds(scope));
  if (account) q = q.eq("account_id", account);
  return q;
}

/** Paginated, sorted list with outstanding/overdue summary of the same wallet selection. */
export async function listInvoices(o: ListOptions, scope: Scope) {
  const today = (await fin()).today();
  let q: any = db().from("invoices").select("*", { count: "exact" });
  q = scoped(q, scope, o.account);
  if (o.status === "overdue")
    q = q.in("status", ["unpaid", "partial"]).not("due_date", "is", null).lt("due_date", today);
  else if (o.status) q = q.eq("status", o.status);
  const s = o.search?.replace(/[%,()*]/g, "").trim();
  if (s) q = q.or(`number.ilike.%${s}%,customer_name.ilike.%${s}%`);
  q = q
    .order(o.sort, { ascending: o.direction === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(o.offset, o.offset + o.limit - 1);
  const [list, open] = await Promise.all([
    q,
    fetchAll((from, to) => {
      let oq: any = db()
        .from("invoices")
        .select("id, status, total, paid, due_date")
        .in("status", ["unpaid", "partial"]);
      oq = scoped(oq, scope, o.account);
      return oq.order("id").range(from, to);
    }),
  ]);
  if (list.error || open.error) {
    const f = await fin();
    if (f.isMissingTable(list.error) || f.isMissingTable(open.error))
      return { ready: false as const };
    throw new Error((list.error ?? open.error)!.message);
  }
  const rows = ((list.data ?? []) as any[]).map(num);
  // v24: "Menunggu verifikasi" while proofs are pending (empty map without v24).
  const pending = await (
    await import("./invoice-payments.server")
  ).pendingProofCounts(
    rows.filter((r) => r.status === "unpaid" || r.status === "partial").map((r) => r.id),
  );
  const items = rows.map((r) => ({
    ...r,
    remaining: remainingOf(r.total, r.paid),
    pending_proofs: pending.get(r.id) ?? 0,
    display_status: displayStatus(r, today, pending.get(r.id) ?? 0),
  }));
  return {
    ready: true as const,
    today,
    items,
    total: list.count ?? items.length,
    summary: invoiceSummary(open.data ?? [], today),
  };
}

export async function loadInvoice(id: string): Promise<InvoiceRow | null> {
  const res = await db().from("invoices").select("*").eq("id", id).maybeSingle();
  if (res.error) {
    if ((await fin()).isMissingTable(res.error)) return null;
    throw new Error(res.error.message);
  }
  return res.data ? num(res.data) : null;
}

/** One invoice with its items and payments (detail view / edit form). */
export async function getInvoice(inv: InvoiceRow) {
  const ip = await import("./invoice-payments.server");
  const [items, pays, today, pending, methodIds] = await Promise.all([
    db().from("invoice_items").select("*").eq("invoice_id", inv.id).order("position"),
    db()
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("paid_at")
      .order("created_at"),
    fin().then((f) => f.today()),
    ip.pendingProofCounts([inv.id]),
    ip.invoiceMethodIds(inv.id),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (pays.error) throw new Error(pays.error.message);
  return {
    ...inv,
    remaining: remainingOf(inv.total, inv.paid),
    pending_proofs: pending.get(inv.id) ?? 0,
    display_status: displayStatus(inv, today, pending.get(inv.id) ?? 0),
    /** v24 payment methods picked for this invoice ([] = all active). */
    method_ids: methodIds,
    items: (items.data ?? []).map((i: any) => ({
      ...i,
      qty: Number(i.qty),
      unit_price: Number(i.unit_price),
    })),
    payments: (pays.data ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) })),
  };
}

/* ---------------- writes ---------------- */

async function invoicePrefix(): Promise<string> {
  const { getAppSettings } = await import("./app-settings.server");
  return (await getAppSettings()).invoice_prefix;
}

async function nextNumber(prefix: string, issueDate: string): Promise<string> {
  const period = issueDate.slice(0, 7).replace("-", "");
  const res = await db()
    .from("invoices")
    .select("number")
    .like("number", `${prefix}-${period}-%`)
    .order("number", { ascending: false })
    .limit(1000);
  if (res.error) throw new Error(res.error.message);
  return nextInvoiceNumber(
    prefix,
    issueDate,
    (res.data ?? []).map((r) => r.number),
  );
}

async function replaceItems(invoiceId: string, items: readonly InvoiceItem[]) {
  const del = await db().from("invoice_items").delete().eq("invoice_id", invoiceId);
  if (del.error) throw new Error(del.error.message);
  if (!items.length) return;
  const ins = await db()
    .from("invoice_items")
    .insert(
      items.map((i, position) => ({
        invoice_id: invoiceId,
        description: i.description.trim(),
        qty: i.qty,
        unit_price: i.unit_price,
        position,
      })),
    );
  if (ins.error) throw new Error(ins.error.message);
}

function assertValid(v: InvoiceInput) {
  const errors = validateInvoice(v);
  if (errors.length) throw new Error(errors[0]);
}

/** Creates an invoice (draft unless `issue`), numbering it with retries on collisions. */
export async function createInvoice(v: InvoiceInput) {
  assertValid(v);
  const total = invoiceTotal(v.items);
  const prefix = await invoicePrefix();
  const base = {
    customer_name: v.customer_name.trim(),
    customer_email: v.customer_email,
    customer_phone: v.customer_phone,
    account_id: v.account_id,
    issue_date: v.issue_date,
    due_date: v.due_date,
    notes: v.notes,
    status: (v.issue ? "unpaid" : "draft") as InvoiceStatus,
    currency: "IDR",
    total,
    paid: 0,
  };
  let row: InvoiceRow | null = null;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const number = await nextNumber(prefix, v.issue_date);
    const res = await db()
      .from("invoices")
      .insert({ ...base, number })
      .select()
      .single();
    if (!res.error) row = num(res.data);
    else if (isDup(res.error)) continue;
    else if ((await fin()).isMissingTable(res.error)) throw new Error(V21_MISSING);
    else throw new Error(res.error.message);
  }
  if (!row) throw new Error("Nomor invoice bentrok, coba lagi");
  try {
    await replaceItems(row.id, v.items);
  } catch (e) {
    await db().from("invoices").delete().eq("id", row.id);
    throw e;
  }
  await (
    await fin()
  ).logActivity("invoices.create", "invoices", {
    name: `${row.number} · ${row.customer_name}`,
    amount: total,
    currency: "IDR",
  });
  return row;
}

/** Edits customer/dates/items of a draft, unpaid or partial invoice (number never changes). */
export async function updateInvoice(prev: InvoiceRow, v: InvoiceInput) {
  assertValid(v);
  const total = invoiceTotal(v.items);
  const problem = editProblem(prev, { total, account_id: v.account_id });
  if (problem) throw new Error(problem);
  const res = await db()
    .from("invoices")
    .update({
      customer_name: v.customer_name.trim(),
      customer_email: v.customer_email,
      customer_phone: v.customer_phone,
      account_id: v.account_id,
      issue_date: v.issue_date,
      due_date: v.due_date,
      notes: v.notes,
      total,
      status: derivedStatus(prev.status, total, prev.paid),
      updated_at: new Date().toISOString(),
    })
    .eq("id", prev.id)
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  await replaceItems(prev.id, v.items);
  await (
    await fin()
  ).logActivity("invoices.update", "invoices", {
    name: `${prev.number} · ${v.customer_name.trim()}`,
    amount: total,
    currency: "IDR",
  });
  return num(res.data);
}

/** issue / cancel / reopen / unissue (see `actionTarget`). */
export async function invoiceAction(inv: InvoiceRow, action: InvoiceAction) {
  const target = actionTarget(action, inv);
  if (!target) throw new Error("Status invoice tidak bisa diubah dengan cara ini");
  const res = await db()
    .from("invoices")
    .update({ status: target, updated_at: new Date().toISOString() })
    .eq("id", inv.id)
    .eq("status", inv.status)
    .select()
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("Invoice berubah, muat ulang halaman");
  await retireGatewayOrders(num(res.data));
  await (
    await fin()
  ).logActivity("invoices.update", "invoices", {
    name: `${inv.number} · ${inv.customer_name}`,
    from: inv.status,
    to: target,
  });
  return num(res.data);
}

/** Deletes an invoice, its items/payments (cascade) and the payments' income transactions. */
export async function deleteInvoice(inv: InvoiceRow) {
  const pays = await db()
    .from("invoice_payments")
    .select("id, transaction_id")
    .eq("invoice_id", inv.id);
  if (pays.error) throw new Error(pays.error.message);
  const txIds = (pays.data ?? []).map((p) => p.transaction_id).filter((x): x is string => !!x);
  const extIds = (pays.data ?? []).map((p) => paymentExternalId(p.id));
  // v25: refuse while a Midtrans order is pending/paid (history must not vanish); drop dead ones.
  await (await import("./gateway/payments.server")).releaseInvoiceGateway(inv.id);
  // v24: proof images live in Storage; the rows go with the invoice (cascade).
  await (await import("./invoice-payments.server")).removeInvoiceProofFiles(inv.id);
  const del = await db().from("invoices").delete().eq("id", inv.id);
  if (del.error) throw new Error(del.error.message);
  await removePaymentTransactions(txIds, extIds);
  await (
    await fin()
  ).logActivity("invoices.delete", "invoices", {
    name: `${inv.number} · ${inv.customer_name}`,
    amount: inv.total,
    currency: "IDR",
  });
  return { ok: true };
}

/** Deletes payment transactions by id, plus any orphan booked under the same external ids. */
async function removePaymentTransactions(txIds: readonly string[], extIds: readonly string[]) {
  if (txIds.length) {
    const r = await db()
      .from("transactions")
      .delete()
      .in("id", [...txIds]);
    if (r.error) throw new Error(r.error.message);
  }
  if (extIds.length) {
    // external_id exists from v7; ignore errors when it does not.
    await db()
      .from("transactions")
      .delete()
      .in("external_id", [...extIds]);
  }
}

/** Re-reads the payments, rewrites `paid` and the derived status. */
export async function syncInvoice(id: string): Promise<InvoiceRow> {
  const inv = await loadInvoice(id);
  if (!inv) throw new Error("Invoice tidak ditemukan");
  // "*" so v25 `refunded` is included when present (paid = amount − refunded).
  const pays = await db().from("invoice_payments").select("*").eq("invoice_id", id);
  if (pays.error) throw new Error(pays.error.message);
  const paid = paidSum(pays.data ?? []);
  const status = derivedStatus(inv.status, inv.total, paid);
  if (paid === inv.paid && status === inv.status) return inv;
  const res = await db()
    .from("invoices")
    .update({ paid, status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  const out = num(res.data);
  await retireGatewayOrders(out);
  return out;
}

/**
 * v25: once the remaining amount or status changes, pending Midtrans orders for another amount (or
 * for an invoice that is no longer open) are expired so the customer cannot overpay. Never throws.
 */
async function retireGatewayOrders(inv: InvoiceRow) {
  const open = inv.status === "unpaid" || inv.status === "partial";
  const { gatewayAmount } = await import("./gateway/types");
  const { retirePendingOrders } = await import("./gateway/payments.server");
  await retirePendingOrders(inv.id, {
    amount: open ? (gatewayAmount(remainingOf(inv.total, inv.paid)) ?? -1) : -1,
  });
}

/**
 * Records a (partial) payment: inserts the payment row, books the income transaction
 * (idempotent per payment id) and recomputes paid/status. Never exceeds the remaining amount.
 */
export async function recordPayment(inv: InvoiceRow, p: PaymentInput) {
  return (await bookPayment(inv, p)).invoice;
}

/** `recordPayment` that also returns the new payment id (v24 proof approval links it). */
export async function bookPayment(
  inv: InvoiceRow,
  p: PaymentInput,
): Promise<{ invoice: InvoiceRow; paymentId: string }> {
  const problem = paymentProblem(inv, p.amount);
  if (problem) throw new Error(problem);
  if (!inv.account_id) throw new Error("Pilih dompet penerima");
  const f = await fin();
  const paidAt = p.paid_at ?? f.today();
  const ins = await db()
    .from("invoice_payments")
    .insert({
      invoice_id: inv.id,
      amount: p.amount,
      paid_at: paidAt,
      method: p.method,
      reference: p.reference,
      note: p.note,
    })
    .select()
    .single();
  if (ins.error) throw new Error(ins.error.message);
  const pay = ins.data;
  // Re-check against concurrent payments; roll back this one when it overshoots.
  const after = await db().from("invoice_payments").select("*").eq("invoice_id", inv.id);
  if (!after.error && paidSum(after.data ?? []) > inv.total + 0.005) {
    await db().from("invoice_payments").delete().eq("id", pay.id);
    throw new Error("Pembayaran melebihi sisa tagihan");
  }
  try {
    const res = await f.createFromExternal(
      {
        kind: "income",
        amount: p.amount,
        currency: "IDR",
        category: INVOICE_CATEGORY,
        account: null,
        to_account: null,
        description: `Pembayaran invoice ${inv.number} · ${inv.customer_name}`,
        merchant: null,
        date: paidAt,
        source: "web",
        items: null,
        notes: p.reference ? `Ref: ${p.reference}` : null,
        external_id: paymentExternalId(pay.id),
        receipt_path: null,
        pocket: null,
      },
      { account_id: inv.account_id },
    );
    const txId = res.transaction.id as string;
    await db().from("invoice_payments").update({ transaction_id: txId }).eq("id", pay.id);
  } catch (e) {
    await db().from("invoice_payments").delete().eq("id", pay.id);
    await removePaymentTransactions([], [paymentExternalId(pay.id)]);
    throw e;
  }
  const updated = await syncInvoice(inv.id);
  await f.logActivity("invoice_payments.create", "invoice_payments", {
    name: `${inv.number} · ${inv.customer_name}`,
    amount: p.amount,
    currency: "IDR",
  });
  return { invoice: updated, paymentId: pay.id as string };
}

export async function loadPayment(id: string) {
  const res = await db().from("invoice_payments").select("*").eq("id", id).maybeSingle();
  if (res.error) {
    if ((await fin()).isMissingTable(res.error)) return null;
    throw new Error(res.error.message);
  }
  return res.data ?? null;
}

/** Deletes a payment and its income transaction, then recomputes paid/status. */
export async function deletePayment(
  inv: InvoiceRow,
  payment: { id: string; amount: number | string; transaction_id: string | null },
) {
  const del = await db().from("invoice_payments").delete().eq("id", payment.id);
  if (del.error) throw new Error(del.error.message);
  await removePaymentTransactions(payment.transaction_id ? [payment.transaction_id] : [], [
    paymentExternalId(payment.id),
  ]);
  const updated = await syncInvoice(inv.id);
  await (
    await fin()
  ).logActivity("invoice_payments.delete", "invoice_payments", {
    name: `${inv.number} · ${inv.customer_name}`,
    amount: Number(payment.amount),
    currency: "IDR",
  });
  return updated;
}
