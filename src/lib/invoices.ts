/**
 * Pure, client-safe invoice helpers (v21, issue #92): money math from items, remaining amount,
 * status derived from payments, allowed manual transitions, overdue (computed, never stored),
 * `<PREFIX>-YYYYMM-####` numbering and form validation. The server recomputes every total with
 * these helpers and never trusts a client total. Unit-tested in src/test/invoices.test.ts.
 *
 * Status model
 * - Stored: draft, unpaid, partial, paid, cancelled. `draft` and `cancelled` are manual; the
 *   other three are derived from the sum of payments after every payment change.
 * - Display-only: `overdue` (unpaid/partial with due_date < today in the app time zone) and
 *   `verifying` (v24, #94: unpaid/partial with at least one pending transfer proof; wins over
 *   overdue because the customer says they paid). Both come from `displayStatus()`; the stored
 *   status never changes until the admin approves a proof.
 */
import { DEFAULT_INVOICE_PREFIX, normalizeInvoicePrefix } from "./app-settings";
import { parseAccountParam } from "./report-filter";

export { DEFAULT_INVOICE_PREFIX };

export const INVOICE_STATUSES = ["draft", "unpaid", "partial", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** List filter values: every stored status plus the computed "overdue". */
export const INVOICE_FILTERS = [...INVOICE_STATUSES, "overdue"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export type DisplayStatus = InvoiceStatus | "overdue" | "verifying";

export const INVOICE_SORTS = ["issue_date", "due_date", "total", "number"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

/** Payment methods recorded by hand (#94/#96/#97 add their own values). */
export const PAYMENT_METHODS = ["transfer", "cash", "qris", "ewallet", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Indonesian i18n keys for statuses and methods. */
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft: "Draft",
  unpaid: "Belum dibayar",
  partial: "Dibayar sebagian",
  paid: "Lunas",
  cancelled: "Dibatalkan",
  overdue: "Terlambat",
  verifying: "Menunggu verifikasi",
};
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: "Transfer bank",
  cash: "Tunai",
  qris: "QRIS",
  ewallet: "E-wallet",
  other: "Lainnya",
};

/** Income category of invoice payments (created on demand like "Piutang"/"Emas"). */
export const INVOICE_CATEGORY = "Invoice";
export const MAX_INVOICE_ITEMS = 100;
/** Max amount of one line / invoice (numeric(18,2) safe). */
export const MAX_AMOUNT = 1e14;

/** Idempotency key of the income transaction of one payment. */
export const paymentExternalId = (paymentId: string) => `invoice_pay:${paymentId}`;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.005;

export type InvoiceItem = { description: string; qty: number; unit_price: number };
export type InvoicePaymentLike = { amount: number | string };

export function lineTotal(qty: number | string, unitPrice: number | string): number {
  const q = Number(qty);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return r2(q * p);
}

/** Invoice total from its items (IDR, 2 decimals). */
export function invoiceTotal(
  items: readonly { qty: number | string; unit_price: number | string }[],
): number {
  return r2(items.reduce((s, i) => s + lineTotal(i.qty, i.unit_price), 0));
}

export function paidSum(payments: readonly InvoicePaymentLike[]): number {
  return r2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

/** Amount still to pay (never negative). */
export function remainingOf(total: number | string, paid: number | string): number {
  return Math.max(0, r2(Number(total) - Number(paid)));
}

/**
 * Stored status after a payment change. draft/cancelled stay as they are (manual states);
 * otherwise nothing paid → unpaid, everything paid → paid, anything in between → partial.
 */
export function derivedStatus(
  current: InvoiceStatus,
  total: number | string,
  paid: number | string,
): InvoiceStatus {
  if (current === "draft" || current === "cancelled") return current;
  const p = Number(paid) || 0;
  if (p <= EPS) return "unpaid";
  if (p + EPS >= Number(total)) return "paid";
  return "partial";
}

/** Manual actions on an invoice (payments drive unpaid/partial/paid). */
export const INVOICE_ACTIONS = ["issue", "cancel", "reopen", "unissue"] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

/**
 * Target status of a manual action, or null when not allowed:
 * - issue: draft → unpaid (needs a positive total);
 * - cancel: draft/unpaid → cancelled, only without payments (delete payments first);
 * - reopen: cancelled → draft;
 * - unissue: unpaid → draft, only without payments.
 */
export function actionTarget(
  action: InvoiceAction,
  inv: { status: InvoiceStatus; total: number | string; paid: number | string },
): InvoiceStatus | null {
  const paid = Number(inv.paid) || 0;
  switch (action) {
    case "issue":
      return inv.status === "draft" && Number(inv.total) > 0 ? "unpaid" : null;
    case "cancel":
      return (inv.status === "draft" || inv.status === "unpaid") && paid <= EPS
        ? "cancelled"
        : null;
    case "reopen":
      return inv.status === "cancelled" ? "draft" : null;
    case "unissue":
      return inv.status === "unpaid" && paid <= EPS ? "draft" : null;
  }
}

export function availableActions(inv: {
  status: InvoiceStatus;
  total: number | string;
  paid: number | string;
}): InvoiceAction[] {
  return INVOICE_ACTIONS.filter((a) => actionTarget(a, inv) !== null);
}

/** Payments can be recorded only on issued, not fully paid invoices. */
export function canRecordPayment(status: InvoiceStatus): boolean {
  return status === "unpaid" || status === "partial";
}

/** Items/customer may change while draft, unpaid or partial (never once paid or cancelled). */
export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === "draft" || status === "unpaid" || status === "partial";
}

/** Overdue = still open (unpaid/partial) and due_date before `today` (YYYY-MM-DD, app zone). */
export function isOverdue(
  inv: { status: InvoiceStatus; due_date?: string | null },
  today: string,
): boolean {
  if (inv.status !== "unpaid" && inv.status !== "partial") return false;
  const due = inv.due_date ? String(inv.due_date).slice(0, 10) : "";
  return !!due && due < today;
}

/**
 * What the UI shows: `verifying` while an open invoice has pending proofs (v24), else `overdue`
 * when past due, else the stored status. `pendingProofs` defaults to 0 (no v24 / not loaded).
 */
export function displayStatus(
  inv: { status: InvoiceStatus; due_date?: string | null },
  today: string,
  pendingProofs = 0,
): DisplayStatus {
  if ((inv.status === "unpaid" || inv.status === "partial") && Number(pendingProofs) > 0)
    return "verifying";
  return isOverdue(inv, today) ? "overdue" : inv.status;
}

/* ---------------- numbering ---------------- */

/** Uppercase letters/digits, 1–10 chars; anything else falls back to INV. */
export const normalizePrefix = normalizeInvoicePrefix;

/** "2026-10-30" → "202610". */
export function numberPeriod(issueDate: string): string {
  return String(issueDate).slice(0, 7).replace("-", "");
}

export function formatInvoiceNumber(prefix: string, issueDate: string, seq: number): string {
  return `${normalizePrefix(prefix)}-${numberPeriod(issueDate)}-${String(Math.max(1, Math.floor(seq))).padStart(4, "0")}`;
}

export function parseInvoiceNumber(
  s: string | null | undefined,
): { prefix: string; period: string; seq: number } | null {
  const m = /^([A-Z0-9]{1,10})-(\d{6})-(\d{4,})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return { prefix: m[1]!, period: m[2]!, seq: Number(m[3]) };
}

/** Next number for `prefix` in the issue month, after the highest existing sequence. */
export function nextInvoiceNumber(
  prefix: string,
  issueDate: string,
  existing: readonly (string | null | undefined)[],
): string {
  const pre = normalizePrefix(prefix);
  const period = numberPeriod(issueDate);
  let max = 0;
  for (const n of existing) {
    const p = parseInvoiceNumber(n);
    if (p && p.prefix === pre && p.period === period && p.seq > max) max = p.seq;
  }
  return formatInvoiceNumber(pre, issueDate, max + 1);
}

/* ---------------- form helpers & validation ---------------- */

/** Editable item row in the form (inputs are strings while typing). */
export type ItemRow = { description: string; qty: string | number; unit_price: string | number };

export const emptyItemRow = (): ItemRow => ({ description: "", qty: 1, unit_price: "" });

/** Drops blank rows and converts the rest to numbers (invalid numbers become NaN for validation). */
export function itemsFromRows(rows: readonly ItemRow[]): InvoiceItem[] {
  return rows
    .filter(
      (r) => String(r.description ?? "").trim() !== "" || String(r.unit_price ?? "").trim() !== "",
    )
    .map((r) => ({
      description: String(r.description ?? "").trim(),
      qty: String(r.qty ?? "").trim() === "" ? NaN : Number(r.qty),
      unit_price: String(r.unit_price ?? "").trim() === "" ? NaN : Number(r.unit_price),
    }));
}

export type InvoiceDraft = {
  customer_name: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  account_id?: string | null;
  issue_date: string;
  due_date?: string | null;
  items: readonly InvoiceItem[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Indonesian i18n keys of every problem (empty = valid). Shared by the form and the server. */
export function validateInvoice(v: InvoiceDraft): string[] {
  const errors: string[] = [];
  if (!String(v.customer_name ?? "").trim()) errors.push("Nama pelanggan wajib diisi");
  const email = String(v.customer_email ?? "").trim();
  if (email && !EMAIL.test(email)) errors.push("Email pelanggan tidak valid");
  if (!v.account_id) errors.push("Pilih dompet penerima");
  if (!DATE.test(String(v.issue_date ?? ""))) errors.push("Tanggal terbit tidak valid");
  const due = String(v.due_date ?? "").trim();
  if (due && !DATE.test(due)) errors.push("Tanggal jatuh tempo tidak valid");
  else if (due && DATE.test(String(v.issue_date)) && due < v.issue_date)
    errors.push("Jatuh tempo tidak boleh sebelum tanggal terbit");
  if (!v.items.length) errors.push("Tambahkan minimal satu item");
  if (v.items.length > MAX_INVOICE_ITEMS) errors.push("Terlalu banyak item (maks. 100)");
  for (const i of v.items) {
    if (!i.description.trim()) {
      errors.push("Deskripsi item wajib diisi");
      break;
    }
  }
  if (v.items.some((i) => !Number.isFinite(i.qty) || i.qty <= 0))
    errors.push("Qty harus lebih dari 0");
  if (v.items.some((i) => !Number.isFinite(i.unit_price) || i.unit_price < 0))
    errors.push("Harga satuan tidak boleh negatif");
  const total = invoiceTotal(v.items.filter((i) => Number.isFinite(i.qty * i.unit_price)));
  if (v.items.length && total <= 0) errors.push("Total invoice harus lebih dari 0");
  if (total > MAX_AMOUNT) errors.push("Total invoice terlalu besar");
  return [...new Set(errors)];
}

/**
 * Problem with an edit of an issued invoice, or null: the new total may not drop below what
 * was already paid, and the wallet cannot change once payments were booked into it.
 */
export function editProblem(
  prev: { status: InvoiceStatus; paid: number | string; account_id?: string | null },
  next: { total: number; account_id?: string | null },
): string | null {
  if (!canEditInvoice(prev.status)) return "Invoice lunas atau dibatalkan tidak bisa diubah";
  const paid = Number(prev.paid) || 0;
  if (paid > EPS && next.total + EPS < paid)
    return "Total tidak boleh lebih kecil dari yang sudah dibayar";
  if (paid > EPS && (prev.account_id ?? null) !== (next.account_id ?? null))
    return "Dompet tidak bisa diganti setelah ada pembayaran";
  return null;
}

/** Problem with a new payment, or null. */
export function paymentProblem(
  inv: { status: InvoiceStatus; total: number | string; paid: number | string },
  amount: number,
): string | null {
  if (!canRecordPayment(inv.status)) return "Invoice ini tidak bisa menerima pembayaran";
  if (!Number.isFinite(amount) || amount <= 0) return "Jumlah harus lebih dari 0";
  if (amount > remainingOf(inv.total, inv.paid) + EPS) return "Pembayaran melebihi sisa tagihan";
  return null;
}

/* ---------------- list search ---------------- */

export type InvoiceSearch = { account?: string; status?: InvoiceFilter };

/** Route `validateSearch` for /invoices: valid `account` (#62 style) and `status` only. */
export function validateInvoiceSearch(search: Record<string, unknown>): InvoiceSearch {
  const out: InvoiceSearch = {};
  const account = parseAccountParam(search["account"]);
  if (account) out.account = account;
  const status = search["status"];
  if (typeof status === "string" && (INVOICE_FILTERS as readonly string[]).includes(status))
    out.status = status as InvoiceFilter;
  return out;
}

/** Outstanding (unpaid + partial) and overdue totals of open invoices. */
export function invoiceSummary(
  rows: readonly {
    status: InvoiceStatus;
    total: number | string;
    paid: number | string;
    due_date?: string | null;
  }[],
  today: string,
): { outstanding: number; open: number; overdue: number; overdueAmount: number } {
  let outstanding = 0;
  let open = 0;
  let overdue = 0;
  let overdueAmount = 0;
  for (const r of rows) {
    if (r.status !== "unpaid" && r.status !== "partial") continue;
    const rem = remainingOf(r.total, r.paid);
    open += 1;
    outstanding += rem;
    if (isOverdue(r, today)) {
      overdue += 1;
      overdueAmount += rem;
    }
  }
  return { outstanding: r2(outstanding), open, overdue, overdueAmount: r2(overdueAmount) };
}
