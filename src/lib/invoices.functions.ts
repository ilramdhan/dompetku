import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";
import {
  INVOICE_ACTIONS,
  INVOICE_FILTERS,
  INVOICE_SORTS,
  MAX_INVOICE_ITEMS,
  PAYMENT_METHODS,
} from "./invoices";

/*
 * v21 Invoice (issue #92). `invoices` is an admin module (ADMIN_MODULES), so every fn uses
 * requireAdmin today. The handlers still pass `accountScope(context)` / assert wallet manage so
 * granting the module to members later (via ROLE_CAPABILITIES) only needs the middleware switched
 * to requireAuth and the classification updated — the data scoping is already in place.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const id = z.string().uuid();
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.preprocess(blank, dateStr.nullable());

const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  qty: z.coerce.number().finite().positive().max(1e9),
  unit_price: z.coerce.number().finite().min(0).max(1e14),
});

const invoiceSchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_email: z.preprocess(blank, z.string().trim().email().max(200).nullable()),
  customer_phone: optText(30),
  account_id: id,
  issue_date: dateStr,
  due_date: optDate,
  notes: optText(2000),
  items: z.array(itemSchema).min(1).max(MAX_INVOICE_ITEMS),
  issue: z.boolean().optional(),
});

const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive().max(1e14),
  paid_at: optDate,
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  reference: optText(120),
  note: optText(500),
});

type Ctx = Parameters<typeof import("./rbac.server").accountScope>[0];

/** Loads an invoice the caller may manage (no existence leak across wallets). */
async function manageable(ctx: Ctx, invoiceId: string) {
  const rbac = await import("./rbac.server");
  const s = await import("./invoices.server");
  const inv = await s.loadInvoice(invoiceId);
  const scope = rbac.accountScope(ctx);
  if (!inv || (scope && (!inv.account_id || !scope.includes(inv.account_id))))
    throw new Error("Invoice tidak ditemukan");
  if (inv.account_id) rbac.assertWalletManage(ctx, inv.account_id);
  return { inv, s };
}

/** Paginated list + outstanding summary (status incl. computed overdue, `?account=`). */
export const getInvoices = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        sort: z.enum(INVOICE_SORTS).default("issue_date"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        status: z.enum(INVOICE_FILTERS).optional(),
        account: id.optional(),
        search: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const { reportScope } = await import("./report-filter");
    const { listInvoices } = await import("./invoices.server");
    const { scope, account } = reportScope(accountScope(context), data.account);
    return (await listInvoices({ ...data, account: account ?? undefined }, scope)) as any;
  });

/** One invoice with items and payment history. */
export const getInvoiceFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const s = await import("./invoices.server");
    const inv = await s.loadInvoice(data.id);
    const scope = accountScope(context);
    if (!inv || (scope && (!inv.account_id || !scope.includes(inv.account_id))))
      throw new Error("Invoice tidak ditemukan");
    return (await s.getInvoice(inv)) as any;
  });

/** Create (draft, or issued with `issue: true`) or edit an invoice. */
export const saveInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id: id.nullable().optional(), values: invoiceSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    rbac.assertWalletView(context, data.values.account_id);
    rbac.assertWalletManage(context, data.values.account_id);
    if (data.id) {
      const { inv, s } = await manageable(context, data.id);
      return (await s.updateInvoice(inv, data.values)) as any;
    }
    const demo = await import("./demo.server");
    await demo.assertDemoCapacity("invoices");
    await demo.assertDemoCapacity("invoice_items");
    const s = await import("./invoices.server");
    return (await s.createInvoice(data.values)) as any;
  });

/** issue / cancel / reopen / unissue. */
export const invoiceActionFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id, action: z.enum(INVOICE_ACTIONS) }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv, s } = await manageable(context, data.id);
    return (await s.invoiceAction(inv, data.action)) as any;
  });

/** Deletes an invoice and the income transactions of its payments. */
export const deleteInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv, s } = await manageable(context, data.id);
    return s.deleteInvoice(inv);
  });

/** Records a full or partial payment (income transaction in category "Invoice"). */
export const recordInvoicePaymentFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id, values: paymentSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv, s } = await manageable(context, data.id);
    await (await import("./demo.server")).assertDemoCapacity("invoice_payments");
    return (await s.recordPayment(inv, data.values)) as any;
  });

/** Deletes a payment and its income transaction. */
export const deleteInvoicePaymentFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await import("./invoices.server");
    const pay = await s.loadPayment(data.id);
    if (!pay) throw new Error("Pembayaran tidak ditemukan");
    const { inv } = await manageable(context, pay.invoice_id);
    return (await s.deletePayment(inv, pay)) as any;
  });

/* ---------------- v23 public link (issue #93) ---------------- */

/** Link status (active/expired/revoked/none); the raw token is never readable again. */
export const getInvoiceShareFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv } = await manageable(context, data.id);
    const share = await import("./invoice-share.server");
    return share.shareStatus(inv.id);
  });

/**
 * Creates or rotates the public link and returns the raw token once. Demo: capped by row count
 * and every link expires within DEMO_SHARE_MAX_DAYS (see invoice-share.ts).
 */
export const createInvoiceShareFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        id,
        expires_days: z.number().int().min(0).max(3650).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { inv } = await manageable(context, data.id);
    const demo = await import("./demo.server");
    await demo.assertDemoCapacity("invoice_shares");
    const share = await import("./invoice-share.server");
    return share.createShare(inv, data.expires_days ?? null, demo.isDemo());
  });

/** Revokes the public link (the page then answers 404). */
export const revokeInvoiceShareFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv } = await manageable(context, data.id);
    const share = await import("./invoice-share.server");
    return share.revokeShare(inv);
  });
