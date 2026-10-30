import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";
import { PAYMENT_SORTS } from "./invoice-report";

/*
 * Invoice reports (issue #98). `invoices` is an admin module, so every fn uses requireAdmin; the
 * handlers still intersect `?account=` with accountScope() like the core fns so a later member
 * grant only needs the middleware and the classification changed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const account = z.string().uuid();

/** Summary (issued/received/outstanding per wallet) for a month + aging of open invoices. */
export const getInvoiceReport = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ month: month.optional(), account: account.optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const { reportScope } = await import("./report-filter");
    const s = await import("./invoice-report.server");
    const { scope, account: acc } = reportScope(accountScope(context), data.account);
    return (await s.invoiceReport(data.month ?? "", scope, acc ?? undefined)) as any;
  });

/** Payments across invoices with server pagination/sort (optionally one month / wallet). */
export const getInvoicePayments = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        sort: z.enum(PAYMENT_SORTS).default("paid_at"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        month: month.optional(),
        account: account.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const { reportScope } = await import("./report-filter");
    const s = await import("./invoice-report.server");
    const { scope, account: acc } = reportScope(accountScope(context), data.account);
    return (await s.listInvoicePayments({ ...data, account: acc ?? undefined }, scope)) as any;
  });

/** Dashboard card: open invoices count + outstanding (admin only). */
export const getOpenInvoices = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { accountScope } = await import("./rbac.server");
    const s = await import("./invoice-report.server");
    return (await s.openInvoiceSummary(accountScope(context))) as any;
  });
