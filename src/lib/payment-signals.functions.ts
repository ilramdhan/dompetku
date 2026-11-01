import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";
import { MATCH_MODES, NOTIFY_LIMITS } from "./bank-notify";

/*
 * v26 bank notifications via MacroDroid (issue #96): notification formats (Settings) and the review
 * queue (Invoice page). Admin only, like the rest of the invoice module. Confirming always goes
 * through `manageable`-style wallet checks on the chosen invoice.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const id = z.string().uuid();
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const formatSchema = z.object({
  name: z.string().trim().min(1).max(NOTIFY_LIMITS.name),
  app_match: optText(NOTIFY_LIMITS.match),
  title_match: optText(NOTIFY_LIMITS.match),
  text_match: optText(NOTIFY_LIMITS.match),
  match_mode: z.enum(MATCH_MODES as ["contains", "regex"]).default("contains"),
  amount_regex: z.string().trim().min(1).max(NOTIFY_LIMITS.regex),
  must_contain: optText(NOTIFY_LIMITS.keywords),
  ignore_contains: optText(NOTIFY_LIMITS.keywords),
  account_id: z.preprocess(blank, id.nullable()).optional(),
  enabled: z.boolean().default(true),
});

/** Formats + whether MacroDroid is configured (token set). `{ ready:false }` before v26. */
export const getNotifyFormatsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const s = await import("./payment-signals.server");
    const [list, cfg] = await Promise.all([s.listFormats(), s.notifyConfig()]);
    return {
      ...list,
      configured: !!cfg,
      auto_confirm: !!cfg?.autoConfirm,
      generic: !!cfg?.generic,
    } as any;
  });

export const saveNotifyFormatFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id: id.nullable().optional(), values: formatSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const demo = await import("./demo.server");
    if (!data.id) await demo.assertDemoCapacity("payment_notify_formats");
    if (data.values.account_id) {
      const rbac = await import("./rbac.server");
      rbac.assertWalletManage(context, data.values.account_id);
    }
    const s = await import("./payment-signals.server");
    return (await s.saveFormat(data.id ?? null, data.values as any)) as any;
  });

export const deleteNotifyFormatFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const s = await import("./payment-signals.server");
    return s.deleteFormat(data.id);
  });

/** Review queue of received notifications (newest first) + open invoices to pick from. */
export const getPaymentSignalsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        filter: z.enum(["open", "confirmed", "ignored", "all"]).default("open"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await import("./payment-signals.server");
    return (await s.listSignals(data)) as any;
  });

/**
 * Confirm a notification for an invoice: books `amount` (≤ remaining) as an invoice payment and,
 * when the received amount equals remaining + the invoice's unique code, the code as a small
 * extra income. Claimed atomically; sends the payment confirmation email (best-effort).
 */
export const confirmSignalFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        id,
        invoice_id: id,
        amount: z.coerce.number().finite().positive().max(1e14),
        paid_at: z.preprocess(blank, dateStr.nullable()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    const inv = await (await import("./invoices.server")).loadInvoice(data.invoice_id);
    const scope = rbac.accountScope(context);
    if (!inv || (scope && (!inv.account_id || !scope.includes(inv.account_id))))
      throw new Error("Invoice tidak ditemukan");
    if (inv.account_id) rbac.assertWalletManage(context, inv.account_id);
    await (await import("./demo.server")).assertDemoCapacity("invoice_payments");
    const s = await import("./payment-signals.server");
    const { splitSignalAmount } = await import("./bank-notify");
    const { remainingOf } = await import("./invoices");
    const signal = await s.loadSignal(data.id);
    if (!signal) throw new Error("Notifikasi tidak ditemukan");
    const remaining = remainingOf(inv.total, inv.paid);
    // Unique code part only when the admin books the whole notification amount.
    const split =
      signal.amount && Math.abs(data.amount - signal.amount) < 0.005
        ? splitSignalAmount(signal.amount, remaining, inv.unique_code)
        : { pay: data.amount, extra: 0 };
    const r = await s.confirmSignal(signal, inv, split.pay, split.extra, data.paid_at, "admin");
    return r.invoice as any;
  });

export const ignoreSignalFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id, reason: optText(300).optional() }).parse(d))
  .handler(async ({ data }) => {
    const s = await import("./payment-signals.server");
    return s.ignoreSignal(data.id, data.reason ?? null);
  });
