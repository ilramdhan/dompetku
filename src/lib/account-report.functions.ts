import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
const month = z.string().regex(/^\d{4}-\d{2}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().uuid();

export const getAccountReport = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id, month }).parse(d))
  .handler(async ({ data, context }) => {
    (await import("./rbac.server")).assertWalletView(context, data.id);
    const { computeAccountReport } = await import("./account-report.server");
    return (await computeAccountReport(data.id, data.month)) as any;
  });

export const getAccountBalanceAt = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id, date }).parse(d))
  .handler(async ({ data, context }) => {
    (await import("./rbac.server")).assertWalletView(context, data.id);
    const { balanceAt } = await import("./account-report.server");
    return balanceAt(data.id, data.date);
  });

export const getReconcileTransactions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ id, from: date, to: date })
      .refine((v) => v.from <= v.to, "rentang tanggal tidak valid")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    rbac.assertWalletView(context, data.id);
    const { reconcileTransactions } = await import("./account-report.server");
    return rbac.maskRows(
      context,
      (await reconcileTransactions(data.id, data.from, data.to)) as any[],
    );
  });

export const saveAccountReconciliation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({ id, as_of: date, statement_balance: z.number().finite().gt(-1e15).lt(1e15) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await (await import("./demo.server")).assertDemoCapacity("account_reconciliations");
    const { saveReconciliation } = await import("./account-report.server");
    return saveReconciliation(data.id, data.as_of, data.statement_balance);
  });
