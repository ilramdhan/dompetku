/**
 * Server-only restore of a Dompetku JSON backup. The browser validates the file with
 * `parseBackup()` and sends it in pieces (≤ RESTORE_CHUNK_ROWS rows / ≤ 2 MB each, so Vercel's
 * 4.5 MB body limit is never hit even for a ~20 MB backup):
 *   1. `clearForReplace()` (replace mode only) — deletes current data in reverse FK order.
 *   2. `restoreChunk()` per table chunk, in RESTORE_TABLES order — upsert on the primary key.
 *   3. `finishRestore()` — logs `backup.restore`.
 * bot_drafts, activity_log and ai_usage (v15 logs) are never exported or restored.
 */
import { db } from "./db.server";
import { isMissingTable, logActivity } from "./finance.server";
import {
  CONFLICT_KEYS,
  NATURAL_KEYS,
  RESTORE_TABLES,
  applyRemap,
  dedupeRows,
  dropColumn,
  missingColumn,
  resolveNaturalKeys,
  stripGenerated,
  type IdRemap,
  type RestoreTable,
  type Row,
} from "./backup";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Deletes all rows of every restorable table in reverse FK order. Missing tables are skipped. */
export async function clearForReplace() {
  const cleared: string[] = [];
  for (const t of [...RESTORE_TABLES].reverse()) {
    const key = CONFLICT_KEYS[t][0]!;
    const res = await db().from(t).delete().not(key, "is", null);
    if (res.error) {
      if (isMissingTable(res.error)) continue;
      throw new Error(`${t}: ${res.error.message}`);
    }
    cleared.push(t);
  }
  return { cleared };
}

async function existingByNaturalKey(table: RestoreTable, rows: Row[]): Promise<Row[]> {
  const cols = NATURAL_KEYS[table];
  if (!cols) return [];
  const first = cols[0]!;
  const values = [...new Set(rows.map((r) => r[first]).filter((v) => v != null))] as string[];
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += 100) {
    const res = await db()
      .from(table)
      .select(["id", ...cols].join(","))
      .in(first, values.slice(i, i + 100));
    if (res.error) {
      // Optional column (e.g. transactions.external_id before v7): nothing to match against.
      if (missingColumn(res.error) || isMissingTable(res.error)) return [];
      throw new Error(`${table}: ${res.error.message}`);
    }
    out.push(...((res.data ?? []) as unknown as Row[]));
  }
  return out;
}

/**
 * Upserts one chunk of backup rows. `remap` carries ids remapped by natural keys in earlier
 * chunks (the client keeps it between calls). Unknown columns are dropped and retried.
 */
export async function restoreChunk(table: RestoreTable, input: Row[], remap: IdRemap) {
  let rows = applyRemap(table, stripGenerated(table, input), remap);
  const nat = resolveNaturalKeys(table, rows, await existingByNaturalKey(table, rows));
  rows = dedupeRows(table, nat.rows);
  const dropped: string[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await db()
      .from(table)
      .upsert(rows as any[], { onConflict: CONFLICT_KEYS[table].join(",") });
    if (!res.error)
      return { ok: true as const, upserted: rows.length, remapped: nat.remapped, dropped };
    if (isMissingTable(res.error))
      return { ok: false as const, skipped: "missing_table" as const, remapped: {}, dropped };
    const col = missingColumn(res.error);
    if (!col || dropped.includes(col) || CONFLICT_KEYS[table].includes(col))
      throw new Error(`${table}: ${res.error.message}`);
    dropped.push(col);
    rows = dropColumn(rows, col);
  }
  throw new Error(`${table}: terlalu banyak kolom tidak dikenal`);
}

export async function finishRestore(detail: {
  mode: "merge" | "replace";
  restored: number;
  tables: number;
  skipped: string[];
}) {
  await logActivity("backup.restore", null, detail);
}
