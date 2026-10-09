import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { transactionSchema } from "./schemas";

const splitRowSchema = z.object({
  category_id: z.string().uuid(),
  amount: z.coerce.number().finite().positive(),
  note: z.string().trim().max(200).nullable().optional(),
});

export const saveSplitTransaction = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        values: transactionSchema.extend({
          receipt_paths: z.array(z.string().min(1).max(500)).max(5).nullable().optional(),
        }),
        rows: z.array(splitRowSchema).min(2).max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    rbac.assertTxWrite(context, data.values);
    rbac.assertReceiptPathsAllowed(context, [
      ...(data.values.receipt_paths ?? []),
      data.values.receipt_path,
    ]);
    const { saveSplitTransaction } = await import("./split.server");
    const res = await saveSplitTransaction(data.values, data.rows);
    return { group: res.group, count: res.transactions.length };
  });

/** Deletes a transaction; `wholeGroup` also deletes its split siblings. Photos are removed. */
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), wholeGroup: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    // Members need manage on the row; a whole split group is checked row by row server-side.
    await rbac.assertTxIdWrite(context, data.id);
    const { deleteTransactionRows } = await import("./split.server");
    return deleteTransactionRows(
      data.id,
      data.wholeGroup,
      context.role === "admin" ? undefined : (row) => rbac.assertTxWrite(context, row),
    );
  });
