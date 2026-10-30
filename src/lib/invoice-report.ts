/**
 * Pure, client-safe invoice report helpers (issue #98): aging buckets, period summary and the
 * per-wallet breakdown. The server feeds these with plain rows; no DB, no clock (callers pass
 * `today` in the app time zone). Unit-tested in src/test/invoice-report.test.ts.
 *
 * Definitions
 * - Counted invoices: every status except draft and cancelled (they never carry payments).
 * - Issued (period) = total of counted invoices whose issue_date falls in the month.
 * - Received (period) = payments whose paid_at falls in the month.
 * - Outstanding (as of period end) = for counted invoices issued before the month's end,
 *   total minus payments dated before that end (never negative).
 * - Aging = open invoices (unpaid/partial) by days past due_date vs `today`; an invoice without
 *   a due date or not yet due is "current".
 */
import { diffDays, monthRange } from "./dates";
import { parseAccountParam } from "./report-filter";
import { remainingOf, type InvoiceStatus } from "./invoices";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const AGING_KEYS = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
export type AgingKey = (typeof AGING_KEYS)[number];
/** Indonesian i18n keys of the buckets. */
export const AGING_LABEL: Record<AgingKey, string> = {
  current: "Belum jatuh tempo",
  d1_30: "1–30 hari",
  d31_60: "31–60 hari",
  d61_90: "61–90 hari",
  d90plus: "> 90 hari",
};

/** Bucket of an open invoice: days = today − due_date (≤ 0 or no due date → current). */
export function agingBucket(dueDate: string | null | undefined, today: string): AgingKey {
  const due = dueDate ? String(dueDate).slice(0, 10) : "";
  if (!due) return "current";
  const days = diffDays(due, today);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

export type AgingInvoice = {
  status: InvoiceStatus;
  total: number | string;
  paid: number | string;
  due_date?: string | null;
};
export type AgingBucket = { key: AgingKey; count: number; amount: number };

/** Outstanding of open (unpaid/partial) invoices split into the five buckets, in fixed order. */
export function agingReport(
  rows: readonly AgingInvoice[],
  today: string,
): { buckets: AgingBucket[]; total: number; count: number; overdue: number; overdueCount: number } {
  const map = new Map<AgingKey, AgingBucket>(
    AGING_KEYS.map((key) => [key, { key, count: 0, amount: 0 }]),
  );
  for (const r of rows) {
    if (r.status !== "unpaid" && r.status !== "partial") continue;
    const rem = remainingOf(r.total, r.paid);
    if (rem <= 0) continue;
    const b = map.get(agingBucket(r.due_date, today))!;
    b.count += 1;
    b.amount = r2(b.amount + rem);
  }
  const buckets = AGING_KEYS.map((k) => map.get(k)!);
  const open = buckets.reduce((s, b) => ({ n: s.n + b.count, a: s.a + b.amount }), { n: 0, a: 0 });
  const late = buckets.filter((b) => b.key !== "current");
  return {
    buckets,
    total: r2(open.a),
    count: open.n,
    overdue: r2(late.reduce((s, b) => s + b.amount, 0)),
    overdueCount: late.reduce((s, b) => s + b.count, 0),
  };
}

export type ReportInvoice = {
  id: string;
  status: InvoiceStatus;
  total: number | string;
  issue_date: string;
  account_id: string | null;
};
export type ReportPayment = { invoice_id: string; amount: number | string; paid_at: string };
export type WalletRow = {
  account_id: string | null;
  issued: number;
  received: number;
  outstanding: number;
};
export type PeriodSummary = {
  issued: number;
  issuedCount: number;
  received: number;
  receivedCount: number;
  outstanding: number;
  outstandingCount: number;
  byWallet: WalletRow[];
};

/** draft/cancelled never count as issued or receivable. */
export const isCounted = (status: InvoiceStatus) => status !== "draft" && status !== "cancelled";

/** Issued / received / outstanding for `month` (YYYY-MM), total and per wallet. */
export function periodSummary(
  invoices: readonly ReportInvoice[],
  payments: readonly ReportPayment[],
  month: string,
): PeriodSummary {
  const { start, end } = monthRange(month);
  const inv = new Map<string, ReportInvoice>();
  for (const i of invoices) if (isCounted(i.status)) inv.set(i.id, i);
  const wallets = new Map<string, WalletRow>();
  const wallet = (id: string | null) => {
    const key = id ?? "";
    let w = wallets.get(key);
    if (!w) wallets.set(key, (w = { account_id: id, issued: 0, received: 0, outstanding: 0 }));
    return w;
  };
  const paidBeforeEnd = new Map<string, number>();
  let issued = 0;
  let issuedCount = 0;
  let received = 0;
  let receivedCount = 0;
  for (const p of payments) {
    const i = inv.get(p.invoice_id);
    if (!i) continue;
    const d = String(p.paid_at).slice(0, 10);
    const amt = Number(p.amount) || 0;
    if (d < end) paidBeforeEnd.set(i.id, (paidBeforeEnd.get(i.id) ?? 0) + amt);
    if (d >= start && d < end) {
      received += amt;
      receivedCount += 1;
      wallet(i.account_id).received += amt;
    }
  }
  let outstanding = 0;
  let outstandingCount = 0;
  for (const i of inv.values()) {
    const d = String(i.issue_date).slice(0, 10);
    if (d >= end) continue;
    const total = Number(i.total) || 0;
    if (d >= start) {
      issued += total;
      issuedCount += 1;
      wallet(i.account_id).issued += total;
    }
    const rem = remainingOf(total, paidBeforeEnd.get(i.id) ?? 0);
    if (rem > 0) {
      outstanding += rem;
      outstandingCount += 1;
      wallet(i.account_id).outstanding += rem;
    }
  }
  const byWallet = [...wallets.values()]
    .map((w) => ({
      ...w,
      issued: r2(w.issued),
      received: r2(w.received),
      outstanding: r2(w.outstanding),
    }))
    .filter((w) => w.issued || w.received || w.outstanding)
    .sort((a, b) => b.outstanding - a.outstanding || b.issued - a.issued);
  return {
    issued: r2(issued),
    issuedCount,
    received: r2(received),
    receivedCount,
    outstanding: r2(outstanding),
    outstandingCount,
    byWallet,
  };
}

/* ---------------- payments list & route search ---------------- */

export const PAYMENT_SORTS = ["paid_at", "amount"] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

export type InvoiceReportSearch = { account?: string; month?: string };

/** Route `validateSearch` for /invoices/report: valid `account` and `month` only. */
export function validateInvoiceReportSearch(search: Record<string, unknown>): InvoiceReportSearch {
  const out: InvoiceReportSearch = {};
  const account = parseAccountParam(search["account"]);
  if (account) out.account = account;
  if (isMonth(search["month"])) out.month = search["month"];
  return out;
}
