/**
 * Pure, client-safe helpers for restoring a Dompetku JSON backup (made by `exportBackup()`).
 * Used by the Settings restore card (validation + preview + chunking) and by
 * `backup.server.ts` (natural-key resolution, id remapping, column dropping). Unit-tested.
 */
import { z } from "zod";

/**
 * FK-safe insert order. `transactions` only references accounts/categories, while
 * gold_purchases / receivables / debt_payments / receivable_payments reference
 * transactions, so transactions go right after accounts & categories.
 * Newer optional tables (v10 recurring_transactions, v11 budget_alerts, v13
 * account_reconciliations) come last: their parents (accounts/categories/budgets) are earlier.
 * bot_drafts, activity_log and ai_usage (v15 logs) are never exported or restored.
 */
export const RESTORE_TABLES = [
  "accounts",
  "categories",
  "transactions",
  "debts",
  "subscriptions",
  "budgets",
  "goals",
  "gold_purchases",
  "receivables",
  "debt_payments",
  "receivable_payments",
  "fx_rates",
  "gold_prices",
  "recurring_transactions",
  "budget_alerts",
  "account_reconciliations",
  "app_settings",
] as const;
export type RestoreTable = (typeof RESTORE_TABLES)[number];

/** Word the user must type to allow "replace" mode (deletes current data first). */
export const REPLACE_CONFIRM_WORD = "GANTI";

/** Rows per upsert request. */
export const RESTORE_CHUNK_ROWS = 500;
/** Max serialized size of one restore request (Vercel caps request bodies at 4.5 MB). */
export const RESTORE_CHUNK_BYTES = 2 * 1024 * 1024;
/** Max backup file size accepted by the restore card (sent to the server in ≤2 MB pieces). */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** Conflict target per table (primary key). */
export const CONFLICT_KEYS: Record<RestoreTable, string[]> = {
  accounts: ["id"],
  categories: ["id"],
  transactions: ["id"],
  debts: ["id"],
  subscriptions: ["id"],
  budgets: ["id"],
  goals: ["id"],
  gold_purchases: ["id"],
  receivables: ["id"],
  debt_payments: ["id"],
  receivable_payments: ["id"],
  fx_rates: ["rate_date", "base", "quote"],
  gold_prices: ["price_date", "source"],
  recurring_transactions: ["id"],
  budget_alerts: ["id"],
  account_reconciliations: ["id"],
  app_settings: ["id"],
};

/**
 * Secondary unique keys. In merge mode a backup row whose natural key already exists in the DB
 * under another id takes over the existing id (and later FK references are rewritten), instead of
 * failing with a unique violation (e.g. the seeded "Makanan & Minuman" category).
 */
export const NATURAL_KEYS: Partial<Record<RestoreTable, string[]>> = {
  categories: ["name", "kind"],
  budgets: ["category_id"],
  debt_payments: ["debt_id", "installment_no"],
  transactions: ["external_id"],
  budget_alerts: ["budget_id", "month", "level"],
};

/** FK column → referenced table, used to rewrite ids remapped by natural keys. */
export const FK_COLUMNS: Record<string, RestoreTable> = {
  account_id: "accounts",
  to_account_id: "accounts",
  category_id: "categories",
  debt_id: "debts",
  transaction_id: "transactions",
  receivable_id: "receivables",
  budget_id: "budgets",
  bot_default_account_id: "accounts",
};

/**
 * Generated (computed) columns that exist in exports but must never be written back —
 * Postgres rejects inserts into them (v12 transactions.items_search).
 */
export const GENERATED_COLUMNS: Partial<Record<RestoreTable, string[]>> = {
  transactions: ["items_search"],
};

/** Strips generated columns from rows before an upsert. */
export function stripGenerated(table: RestoreTable, rows: Row[]): Row[] {
  const cols = GENERATED_COLUMNS[table];
  if (!cols?.length) return rows;
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const c of cols) delete out[c];
    return out;
  });
}

export type Row = Record<string, unknown>;
/** table → { backupId: dbId } */
export type IdRemap = Partial<Record<RestoreTable, Record<string, string>>>;

const backupSchema = z.object({
  app: z.literal("dompetku"),
  version: z.number().int().min(1).max(1),
  exportedAt: z.string().optional(),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export type ParsedBackup = {
  exportedAt: string | null;
  tables: { table: RestoreTable; rows: Row[] }[];
  /** Tables in the file that are not restored (unknown, bot_drafts, activity_log, ai_usage). */
  ignored: string[];
  total: number;
};

export function isRestoreTable(t: string): t is RestoreTable {
  return (RESTORE_TABLES as readonly string[]).includes(t);
}

/** Validates a backup file (text or already-parsed JSON) and groups rows in FK-safe order. */
export function parseBackup(
  input: string | unknown,
): { ok: true; backup: ParsedBackup } | { ok: false; error: string } {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: "Berkas bukan JSON yang valid" };
    }
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const app = (raw as { app?: unknown } | null)?.app;
    if (app !== "dompetku") return { ok: false, error: "Bukan berkas cadangan Dompetku" };
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `Format cadangan tidak dikenali${first ? ` (${first.path.join(".")}: ${first.message})` : ""}`,
    };
  }
  const { data, exportedAt } = parsed.data;
  const ignored = Object.keys(data).filter((t) => !isRestoreTable(t));
  const tables = RESTORE_TABLES.filter((t) => Array.isArray(data[t])).map((t) => ({
    table: t,
    rows: data[t] as Row[],
  }));
  for (const { table, rows } of tables) {
    const keys = CONFLICT_KEYS[table];
    const bad = rows.findIndex((r) => keys.some((k) => r[k] == null || r[k] === ""));
    if (bad >= 0)
      return {
        ok: false,
        error: `Baris ${bad + 1} di tabel ${table} tidak punya ${keys.join("/")}`,
      };
  }
  return {
    ok: true,
    backup: {
      exportedAt: exportedAt ?? null,
      tables,
      ignored,
      total: tables.reduce((s, x) => s + x.rows.length, 0),
    },
  };
}

/** Splits rows into pieces of ≤ maxRows rows and ≤ maxBytes serialized JSON (a single huge row still gets its own piece). */
export function chunkRows<T>(
  rows: T[],
  maxRows = RESTORE_CHUNK_ROWS,
  maxBytes = RESTORE_CHUNK_BYTES,
): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 2;
  for (const r of rows) {
    const size = JSON.stringify(r).length + 1;
    if (cur.length && (cur.length >= maxRows || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 2;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Rewrites own ids and FK columns using ids remapped in earlier tables/chunks. */
export function applyRemap(table: RestoreTable, rows: Row[], remap: IdRemap): Row[] {
  return rows.map((r) => {
    const out: Row = { ...r };
    const own = remap[table];
    if (own && typeof out["id"] === "string" && own[out["id"] as string])
      out["id"] = own[out["id"] as string];
    for (const [col, ref] of Object.entries(FK_COLUMNS)) {
      const v = out[col];
      const m = remap[ref];
      if (typeof v === "string" && m && m[v]) out[col] = m[v];
    }
    return out;
  });
}

const keyOf = (r: Row, cols: string[]) => JSON.stringify(cols.map((c) => r[c] ?? null));

/**
 * Merge mode: rows whose natural key matches an existing DB row with a different id take that id.
 * Returns the adjusted rows and the new backupId → dbId pairs. Rows with a null natural key
 * (e.g. transactions without external_id) are left alone.
 */
export function resolveNaturalKeys(
  table: RestoreTable,
  rows: Row[],
  existing: Row[],
): { rows: Row[]; remapped: Record<string, string> } {
  const cols = NATURAL_KEYS[table];
  const remapped: Record<string, string> = {};
  if (!cols) return { rows, remapped };
  const byKey = new Map<string, string>();
  for (const e of existing)
    if (cols.every((c) => e[c] != null) && typeof e["id"] === "string")
      byKey.set(keyOf(e, cols), e["id"] as string);
  const out = rows.map((r) => {
    if (!cols.every((c) => r[c] != null)) return r;
    const hit = byKey.get(keyOf(r, cols));
    if (hit && typeof r["id"] === "string" && hit !== r["id"]) {
      remapped[r["id"] as string] = hit;
      return { ...r, id: hit };
    }
    return r;
  });
  return { rows: out, remapped };
}

/** Removes rows repeating a conflict key within one upsert (Postgres rejects that); last one wins. */
export function dedupeRows(table: RestoreTable, rows: Row[]): Row[] {
  const keys = CONFLICT_KEYS[table];
  const nat = NATURAL_KEYS[table];
  const seen = new Map<string, Row>();
  const seenNat = new Map<string, string>();
  for (const r of rows) {
    if (nat && nat.every((c) => r[c] != null)) {
      const nk = keyOf(r, nat);
      const prev = seenNat.get(nk);
      if (prev !== undefined) seen.delete(prev);
      seenNat.set(nk, keyOf(r, keys));
    }
    const k = keyOf(r, keys);
    seen.delete(k);
    seen.set(k, r);
  }
  return [...seen.values()];
}

/** Column name from a PostgREST/Postgres "unknown column" error, or null. */
export function missingColumn(err: { message?: string; code?: string } | null | undefined) {
  const msg = err?.message ?? "";
  const m =
    /Could not find the '([^']+)' column/i.exec(msg) ??
    /column "([^"]+)"(?: of relation "[^"]+")? does not exist/i.exec(msg);
  return m ? m[1]! : null;
}

export function dropColumn(rows: Row[], col: string): Row[] {
  return rows.map((r) => {
    const { [col]: _drop, ...rest } = r;
    void _drop;
    return rest;
  });
}

/** Suggested file name for a backup made on `date` (YYYY-MM-DD). */
export function backupFilename(date: Date = new Date()): string {
  return `dompetku-cadangan-${date.toISOString().slice(0, 10)}.json`;
}
