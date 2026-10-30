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
import { MAX_METHODS, METHOD_KINDS, PROOF_LIMITS, PROOF_STATUSES } from "./invoice-payments";

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
  /** v24: payment methods shown on the public page ([] = all active; omitted = unchanged). */
  method_ids: z.array(id).max(MAX_METHODS).optional(),
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
    const pm = await import("./invoice-payments.server");
    if (data.id) {
      const { inv, s } = await manageable(context, data.id);
      const row = await s.updateInvoice(inv, data.values);
      await pm.setInvoiceMethods(row.id, data.values.method_ids);
      return row as any;
    }
    const demo = await import("./demo.server");
    await demo.assertDemoCapacity("invoices");
    await demo.assertDemoCapacity("invoice_items");
    const s = await import("./invoices.server");
    const row = await s.createInvoice(data.values);
    if (data.values.method_ids?.length) {
      await demo.assertDemoCapacity("invoice_payment_methods");
      await pm.setInvoiceMethods(row.id, data.values.method_ids);
    }
    return row as any;
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
    const updated = await s.recordPayment(inv, data.values);
    // #95: best-effort confirmation mail (no link, never throws, no-op without Resend/email).
    await (
      await import("./invoice-email.server")
    ).sendPaymentConfirmation(updated, data.values.amount);
    return updated as any;
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
    // v25: a Midtrans payment is undone with a refund, never deleted.
    await (await import("./gateway/payments.server")).assertPaymentNotGateway(pay.id);
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

/* ---------------- email to the customer (issue #95) ---------------- */

/**
 * "Kirim invoice": emails the customer the public link. Creates the link, or rotates the existing
 * one (only the hash is stored, so it cannot be recovered; the UI confirms first). Preconditions
 * (issued, customer email, Resend) are checked before the link is touched.
 */
export const sendInvoiceEmailFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({ id, expires_days: z.number().int().min(0).max(3650).nullable().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { inv } = await manageable(context, data.id);
    (await import("./demo.server")).assertNotDemo();
    const { getRequest } = await import("@tanstack/react-start/server");
    const { seoConfig } = await import("./seo.server");
    const origin = seoConfig().siteUrl ?? new URL(getRequest().url).origin;
    const mail = await import("./invoice-email.server");
    return mail.sendInvoiceLinkEmail(inv, { origin, expiresDays: data.expires_days ?? null });
  });

/* ---------------- v24 payment methods & proof verification (issue #94) ---------------- */

const methodSchema = z.object({
  kind: z.enum(METHOD_KINDS),
  label: z.string().trim().min(1).max(60),
  bank_name: optText(60),
  account_number: optText(40),
  account_holder: optText(80),
  // ≤200 KB raster data URL (validated again by validateMethod / isLogoDataUrl).
  qris_image: z.string().max(300_000).nullable().optional(),
  account_id: z.preprocess(blank, id.nullable()).optional(),
  active: z.boolean().optional(),
});

/** Bank/QRIS methods (admin view incl. linked wallet). `{ ready:false }` before v24. */
export const getPaymentMethodsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const pm = await import("./invoice-payments.server");
    return (await pm.listMethods()) as any;
  });

/**
 * Create/edit a method. Demo: new rows are capped, and QRIS images are refused like the logo
 * (image uploads are off in demo).
 */
export const savePaymentMethodFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id: id.nullable().optional(), values: methodSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const demo = await import("./demo.server");
    if (data.values.qris_image) demo.assertNotDemo();
    if (data.values.account_id) {
      const rbac = await import("./rbac.server");
      rbac.assertWalletManage(context, data.values.account_id);
    }
    if (!data.id) await demo.assertDemoCapacity("payment_methods");
    const pm = await import("./invoice-payments.server");
    return (await pm.saveMethod(data.id ?? null, data.values as any)) as any;
  });

export const deletePaymentMethodFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const pm = await import("./invoice-payments.server");
    return pm.deleteMethod(data.id);
  });

/** Verification queue: pending (oldest first) or history, scoped to the caller's wallets. */
export const getInvoiceProofsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.enum([...PROOF_STATUSES, "all"]).default("pending"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        invoice: id.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const pm = await import("./invoice-payments.server");
    return (await pm.listProofs(data, accountScope(context))) as any;
  });

async function reviewable(ctx: Ctx, proofId: string) {
  const pm = await import("./invoice-payments.server");
  const proof = await pm.loadProof(proofId);
  if (!proof) throw new Error("Bukti tidak ditemukan");
  const { inv, s } = await manageable(ctx, proof.invoice_id);
  return { proof, inv, s, pm };
}

/** 2-minute signed URL of a proof image (private bucket). */
export const getProofUrlFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { proof, pm } = await reviewable(context, data.id);
    return { url: await pm.proofUrl(proof) };
  });

/** Approve: books an invoice payment (+ income) for `amount` (≤ remaining), once. */
export const approveProofFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        id,
        amount: z.coerce.number().finite().positive().max(1e14),
        paid_at: optDate,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { proof, inv, pm } = await reviewable(context, data.id);
    await (await import("./demo.server")).assertDemoCapacity("invoice_payments");
    const updated = await pm.approveProof(proof, inv, data.amount, data.paid_at);
    await (await import("./invoice-email.server")).sendPaymentConfirmation(updated, data.amount);
    return updated as any;
  });

/** Reject with a reason (shown only to the admin). */
export const rejectProofFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id, reason: z.string().trim().min(1).max(PROOF_LIMITS.reject_reason) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { proof, inv, pm } = await reviewable(context, data.id);
    return pm.rejectProof(proof, inv, data.reason);
  });

/* ---------------- v25 payment gateway (issue #97) ---------------- */

/** Midtrans orders of one invoice (status, amount, time). `{ ready:false }` before v25. */
export const getGatewayTransactionsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const { inv } = await manageable(context, data.id);
    const gw = await import("./gateway/payments.server");
    return (await gw.listGatewayTransactions(inv.id)) as any;
  });

async function gatewayRowFor(ctx: Ctx, rowId: string) {
  const gw = await import("./gateway/payments.server");
  const row = await gw.loadGatewayRow({ id: rowId });
  if (!row) throw new Error("Transaksi gateway tidak ditemukan");
  const { inv } = await manageable(ctx, row.invoice_id);
  return { row, inv, gw };
}

/** "Cek status": re-reads one order from Midtrans and applies it (books a missed settlement). */
export const syncGatewayFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    (await import("./demo.server")).assertNotDemo();
    const { row, gw } = await gatewayRowFor(context, data.id);
    const c = await gw.requireConfig();
    const r = await gw.syncRow(c, row);
    return { status: r.row.status, booked: r.booked, note: r.note };
  });

/** Refund (full or partial) through the Midtrans API; books a reversing expense. */
export const refundGatewayFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        id,
        amount: z.coerce.number().finite().positive().max(1e12),
        reason: z.string().trim().max(255).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    (await import("./demo.server")).assertNotDemo();
    const { row, gw } = await gatewayRowFor(context, data.id);
    const r = await gw.refundGateway(row, data.amount, data.reason);
    return { status: r.status, refunded_amount: r.refunded_amount };
  });
