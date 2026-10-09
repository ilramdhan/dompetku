import { db } from "./db.server";
import { ensureCategory, getUsdIdr, logActivity } from "./finance.server";
import { FEE_CATEGORY } from "./fees";
import { missingColumn } from "./backup";
import { receiptPaths } from "./receipts";
import { splitDescription, validateSplit, type SplitRow } from "./split";
import type { TransactionInput } from "./schemas";
import type { Json, Tables, TablesInsert } from "./database.types";

type TxRow = Tables<"transactions">;
type TxInsert = TablesInsert<"transactions">;

/** Columns from optional schema sections that are dropped and retried when missing. */
const OPTIONAL = ["split_group", "receipt_paths", "receipt_path", "external_id"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Bulk insert (one statement → atomic); drops optional columns the DB does not have yet. */
async function insertRows(rows: TxInsert[]): Promise<TxRow[]> {
  await (await import("./demo.server")).assertDemoCapacity("transactions");
  let current = rows as Record<string, unknown>[];
  for (let i = 0; i <= OPTIONAL.length; i++) {
    const res = await db()
      .from("transactions")
      .insert(current as TxInsert[])
      .select();
    if (!res.error) return res.data ?? [];
    const col = missingColumn(res.error) ?? OPTIONAL.find((c) => res.error.message.includes(c));
    if (!col || !OPTIONAL.includes(col) || !current.some((r) => col in r))
      throw new Error(res.error.message);
    current = current.map(({ [col]: _drop, ...rest }) => rest);
  }
  throw new Error("Gagal menyimpan split");
}

/**
 * Saves one receipt split over several expense categories as N sibling expense transactions
 * sharing `split_group` (same date/account/merchant/receipt). The admin fee is recorded once.
 */
export async function saveSplitTransaction(
  base: TransactionInput & { receipt_paths?: string[] | null | undefined },
  rows: SplitRow[],
) {
  if (base.kind !== "expense") throw new Error("Split hanya untuk pengeluaran");
  const err = validateSplit(base.amount, rows);
  if (err) throw new Error(err);
  const rate = base.currency === "USD" ? await getUsdIdr() : 1;
  const idr = (n: number) => r2(n * rate);
  const group = crypto.randomUUID();
  const paths = base.receipt_paths?.length ? base.receipt_paths : null;
  const inserts: TxInsert[] = rows.map((r, i) => ({
    kind: "expense",
    amount: r2(Number(r.amount)),
    currency: base.currency,
    amount_idr: idr(Number(r.amount)),
    account_id: base.account_id,
    to_account_id: null,
    category_id: r.category_id,
    description: splitDescription(base.description, i, rows.length, r.note),
    merchant: base.merchant,
    occurred_at: base.occurred_at,
    source: base.source,
    // Items stay on the first row only (searchable once, not duplicated).
    items: i === 0 ? ((base.items ?? null) as Json) : null,
    notes: base.notes,
    receipt_path: paths?.[0] ?? base.receipt_path ?? null,
    ...(paths ? { receipt_paths: paths } : {}),
    split_group: group,
    raw: null,
  }));
  const saved = await insertRows(inserts);
  const fee = Number(base.fee) || 0;
  if (fee > 0) {
    try {
      await insertRows([
        {
          kind: "expense",
          amount: fee,
          currency: base.currency,
          amount_idr: idr(fee),
          account_id: base.account_id,
          category_id: await ensureCategory(FEE_CATEGORY, "expense"),
          description: `Biaya admin${base.description ? `: ${base.description}` : ""}`,
          occurred_at: base.occurred_at,
          source: base.source,
          notes: `[fee:${saved[0]!.id}]`,
        },
      ]);
    } catch (e) {
      // Keep it all-or-nothing: remove the split rows that were just inserted.
      await db()
        .from("transactions")
        .delete()
        .in(
          "id",
          saved.map((s) => s.id),
        );
      throw e;
    }
  }
  await logActivity("transaction.split", "transactions", {
    description: base.description ?? base.merchant ?? null,
    amount: base.amount,
    currency: base.currency,
    rows: rows.length,
  });
  return { group, transactions: saved };
}

/** Removes receipt photos of the given rows that no remaining transaction still references. */
export async function removeOrphanPhotos(
  rows: Pick<TxRow, "receipt_path" | "receipt_paths">[],
  deletedIds: string[],
) {
  const paths = [...new Set(rows.flatMap((r) => receiptPaths(r)))];
  if (!paths.length) return;
  const { removeReceipt } = await import("./receipt.server");
  for (const p of paths) {
    const still = await db()
      .from("transactions")
      .select("id")
      .eq("receipt_path", p)
      .not("id", "in", `(${deletedIds.join(",")})`)
      .limit(1);
    if (!still.error && still.data?.length) continue;
    const inArr = await db()
      .from("transactions")
      .select("id")
      .contains("receipt_paths", [p])
      .not("id", "in", `(${deletedIds.join(",")})`)
      .limit(1);
    if (!inArr.error && inArr.data?.length) continue; // error = v12 not run → no arrays to check
    await removeReceipt(p);
  }
}

/**
 * Deletes a transaction (or its whole split group when `wholeGroup`), removing photos that no
 * remaining sibling uses. Returns the number of rows deleted.
 */
export async function deleteTransactionRows(
  id: string,
  wholeGroup: boolean,
  /** v18: throws when the caller may not delete a row (members; split rows share one wallet). */
  check?: (row: TxRow) => void,
) {
  const one = await db().from("transactions").select("*").eq("id", id).maybeSingle();
  if (one.error) throw new Error(one.error.message);
  if (!one.data) return { deleted: 0 };
  let rows: TxRow[] = [one.data];
  if (wholeGroup && one.data.split_group) {
    const g = await db().from("transactions").select("*").eq("split_group", one.data.split_group);
    if (g.error) throw new Error(g.error.message);
    rows = g.data ?? rows;
  }
  if (check) for (const r of rows) check(r);
  const ids = rows.map((r) => r.id);
  const del = await db().from("transactions").delete().in("id", ids);
  if (del.error) throw new Error(del.error.message);
  await removeOrphanPhotos(rows, ids);
  const p = one.data;
  await logActivity("transactions.delete", "transactions", {
    name: p.description ?? null,
    amount: wholeGroup ? rows.reduce((a, r) => a + Number(r.amount), 0) : p.amount,
    currency: p.currency,
    ...(rows.length > 1 ? { rows: rows.length } : {}),
  });
  return { deleted: ids.length };
}
