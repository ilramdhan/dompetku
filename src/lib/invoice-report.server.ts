/**
 * Invoice reports (issue #98): period summary + aging and the cross-invoice payment list.
 * Pure math lives in ./invoice-report.ts. Reads degrade to `{ ready: false }` before schema v21.
 * Callers pass `accountScope(ctx)` already intersected with `?account=` via `reportScope()`.
 */
import { db } from "./db.server";
import { fetchAll } from "./paginate";
import { scopeIds } from "./permissions";
import { NO_ACCOUNT } from "./report-filter";
import { agingReport, isMonth, periodSummary, type PaymentSort } from "./invoice-report";
import { monthRange } from "./dates";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Scope = readonly string[] | null | undefined;

const fin = () => import("./finance.server");

function scoped(q: any, scope: Scope, account?: string) {
  if (scope) q = q.in("account_id", scopeIds(scope));
  if (account) q = q.eq("account_id", account);
  return q;
}

const empty = (account?: string) => account === NO_ACCOUNT;

export async function invoiceReport(month: string, scope: Scope, account?: string) {
  const f = await fin();
  const today = f.today();
  const m = isMonth(month) ? month : today.slice(0, 7);
  const { end } = monthRange(m);
  if (empty(account)) {
    return {
      ready: true as const,
      today,
      month: m,
      summary: periodSummary([], [], m),
      aging: agingReport([], today),
    };
  }
  // Issued before the period end and not draft/cancelled: enough for summary + current aging.
  const invoices = await fetchAll((from, to) => {
    let q: any = db()
      .from("invoices")
      .select("id, status, total, paid, issue_date, due_date, account_id")
      .in("status", ["unpaid", "partial", "paid"]);
    q = scoped(q, scope, account);
    return q.order("id").range(from, to);
  });
  if (invoices.error) {
    if (f.isMissingTable(invoices.error)) return { ready: false as const };
    throw new Error(invoices.error.message);
  }
  const rows = (invoices.data ?? []) as any[];
  const ids = new Set(rows.map((r) => r.id as string));
  const pays = await fetchAll((from, to) =>
    db()
      .from("invoice_payments")
      .select("invoice_id, amount, paid_at")
      .lt("paid_at", end)
      .order("id")
      .range(from, to),
  );
  if (pays.error) {
    if (f.isMissingTable(pays.error)) return { ready: false as const };
    throw new Error(pays.error.message);
  }
  const payments = ((pays.data ?? []) as any[]).filter((p) => ids.has(p.invoice_id));
  return {
    ready: true as const,
    today,
    month: m,
    summary: periodSummary(rows, payments, m),
    // Aging is "as of today" over currently open invoices, whatever the month picker shows.
    aging: agingReport(rows, today),
  };
}

export type PaymentListOptions = {
  offset: number;
  limit: number;
  sort: PaymentSort;
  direction: "asc" | "desc";
  month?: string | undefined;
  account?: string | undefined;
};

/** Payments across invoices (optionally one month), joined with invoice number/customer/wallet. */
export async function listInvoicePayments(o: PaymentListOptions, scope: Scope) {
  const f = await fin();
  if (empty(o.account)) return { ready: true as const, items: [], total: 0 };
  let q: any = db()
    .from("invoice_payments")
    .select(
      "id, invoice_id, amount, paid_at, method, reference, created_at, invoices!inner(number, customer_name, account_id)",
      { count: "exact" },
    );
  if (scope) q = q.in("invoices.account_id", scopeIds(scope));
  if (o.account) q = q.eq("invoices.account_id", o.account);
  if (o.month && isMonth(o.month)) {
    const { start, end } = monthRange(o.month);
    q = q.gte("paid_at", start).lt("paid_at", end);
  }
  q = q
    .order(o.sort, { ascending: o.direction === "asc" })
    .order("created_at", { ascending: false })
    .range(o.offset, o.offset + o.limit - 1);
  const res = await q;
  if (res.error) {
    if (f.isMissingTable(res.error)) return { ready: false as const };
    throw new Error(res.error.message);
  }
  const items = ((res.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    invoice_id: r.invoice_id as string,
    amount: Number(r.amount),
    paid_at: r.paid_at as string,
    method: r.method as string,
    reference: (r.reference ?? null) as string | null,
    number: r.invoices?.number as string,
    customer_name: r.invoices?.customer_name as string,
    account_id: (r.invoices?.account_id ?? null) as string | null,
  }));
  return { ready: true as const, items, total: res.count ?? items.length };
}

/** Dashboard card: open count + outstanding, or null when v21 is missing. */
export async function openInvoiceSummary(scope: Scope) {
  const f = await fin();
  const res = await fetchAll((from, to) => {
    let q: any = db()
      .from("invoices")
      .select("id, status, total, paid, due_date")
      .in("status", ["unpaid", "partial"]);
    q = scoped(q, scope);
    return q.order("id").range(from, to);
  });
  if (res.error) {
    if (f.isMissingTable(res.error)) return { ready: false as const };
    throw new Error(res.error.message);
  }
  const { invoiceSummary } = await import("./invoices");
  return { ready: true as const, ...invoiceSummary((res.data ?? []) as any[], f.today()) };
}
