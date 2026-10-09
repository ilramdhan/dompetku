import { db } from "./db.server";
import { cachedAppSettings, getAppSettings } from "./app-settings.server";
import { dueMonthlyFees, feeDate, FEE_CATEGORY, withTax } from "./fees";
import { addDays, addMonthsKeepDay, diffDays, monthRange, shiftMonth, todayStr } from "./dates";
import type { ExternalTx, TransactionInput } from "./schemas";
import { dupKey } from "./csv";
import { fetchAll } from "./paginate";
import { planGoalFunds } from "./goals";
import { receiptColumns } from "./receipts";
import { budgetPercent } from "./budget";
import type { Json, Tables, TablesInsert } from "./database.types";
import { scopeIds, txScopeFilter, walletNetByMonth } from "./permissions";
import {
  categoriesByName,
  categorySlices,
  categoryTrendSeries,
  kindTotal,
  monthSeries,
  normalizeNet,
  normalizeTotals,
  once,
  spentByCategory,
  sqlOrFallback,
  sumCategories,
  sumMonthCategories,
  sumMonthKind,
  sumMonthlyNet,
  topCategoryTrend,
  type CategoryTotal,
  type MonthCategoryTotal,
  type MonthKindTotal,
  type MonthNet,
} from "./aggregate";

type TxRow = Tables<"transactions">;
type TxInsert = TablesInsert<"transactions">;
type NamedRef = { name: string } | null;
type CatRef = { name: string; color: string | null } | null;
/** Joined select rows (PostgREST embeds); Number() still guards numeric-as-string values. */
type TxListRow = TxRow & {
  category: { id: string; name: string; color: string | null } | null;
  account: { id: string; name: string } | null;
  to_account: { id: string; name: string } | null;
};
type AmountRow = Pick<TxRow, "kind" | "amount_idr" | "occurred_at">;
type DupRow = Pick<TxRow, "occurred_at" | "kind" | "amount" | "currency" | "description">;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Res = { data: unknown; error: { message: string } | null };
/** Unwraps a PostgREST result: throws on error, otherwise returns `data` (non-null on success). */
function must<T = never, R extends Res = Res>(
  res: R,
): [T] extends [never] ? NonNullable<R["data"]> : T {
  if (res.error) throw new Error(res.error.message);
  return res.data as [T] extends [never] ? NonNullable<R["data"]> : T;
}

/** "Today" in the Settings time zone (v14), else APP_TIMEZONE, else Asia/Jakarta. */
export const today = () => todayStr(cachedAppSettings().timezone);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** True when PostgREST reports a table that has not been created yet (schema v3 not run). */
export function isMissingTable(
  err: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    /could not find the table|does not exist/i.test(err.message ?? "")
  );
}

/* ---------------- Activity log ---------------- */
// v18 activity_log.actor is optional: once PostgREST reports it missing, inserts/reads skip it.
let actorColumnMissing = false;

export async function logActivity(action: string, entity?: string | null, detail?: unknown) {
  try {
    const { currentActor } = await import("./request-context.server");
    const actor = actorColumnMissing ? null : currentActor();
    const row: TablesInsert<"activity_log"> = {
      action,
      entity: entity ?? null,
      detail: (detail ?? null) as Json,
    };
    let res = await db()
      .from("activity_log")
      .insert(actor ? { ...row, actor } : row);
    if (res.error && actor && /actor/.test(res.error.message)) {
      actorColumnMissing = true;
      res = await db().from("activity_log").insert(row);
    }
    if (res.error && !isMissingTable(res.error))
      console.error("activity log failed", res.error.message);
  } catch (e) {
    console.error("activity log failed", e);
  }
}

export async function listActivity(limit = 30) {
  try {
    const run = (cols: string) =>
      db().from("activity_log").select(cols).order("created_at", { ascending: false }).limit(limit);
    let res = await run(
      actorColumnMissing
        ? "id, action, entity, detail, created_at"
        : "id, action, entity, detail, created_at, actor",
    );
    if (res.error && !actorColumnMissing && /actor/.test(res.error.message)) {
      actorColumnMissing = true;
      res = await run("id, action, entity, detail, created_at");
    }
    if (res.error) {
      if (!isMissingTable(res.error)) console.error("activity list failed", res.error.message);
      return [] as Tables<"activity_log">[];
    }
    return (res.data ?? []) as unknown as Tables<"activity_log">[];
  } catch (e) {
    console.error("activity list failed", e);
    return [] as Tables<"activity_log">[];
  }
}

/* ---------------- FX ---------------- */
// Warm-lambda memo: one rate per day, re-checked every 10 min. Only real (cached/fetched) rates are
// memoised; the "last known / env" fallback is retried on the next call, exactly as before.
const FX_MEMO_TTL_MS = 10 * 60 * 1000;
const fxMemo = new Map<string, { at: number; rate: Promise<{ rate: number; fresh: boolean }> }>();

export async function getUsdIdr(): Promise<number> {
  const d = today();
  const hit = fxMemo.get(d);
  if (hit && Date.now() - hit.at < FX_MEMO_TTL_MS) return (await hit.rate).rate;
  const rate = loadUsdIdr(d);
  fxMemo.clear();
  fxMemo.set(d, { at: Date.now(), rate });
  try {
    const r = await rate;
    if (!r.fresh && fxMemo.get(d)?.rate === rate) fxMemo.delete(d);
    return r.rate;
  } catch (e) {
    if (fxMemo.get(d)?.rate === rate) fxMemo.delete(d);
    throw e;
  }
}

async function loadUsdIdr(d: string): Promise<{ rate: number; fresh: boolean }> {
  const cached = await db()
    .from("fx_rates")
    .select("rate")
    .eq("rate_date", d)
    .eq("base", "USD")
    .eq("quote", "IDR")
    .maybeSingle();
  if (cached.data) return { rate: Number(cached.data.rate), fresh: true };
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = (await res.json()) as { rates?: Record<string, unknown> } | null;
    const rate = Number(j?.rates?.["IDR"]);
    if (rate > 0) {
      await db().from("fx_rates").upsert({ rate_date: d, base: "USD", quote: "IDR", rate });
      return { rate, fresh: true };
    }
  } catch (e) {
    console.error("FX fetch failed", e);
  }
  const last = await db()
    .from("fx_rates")
    .select("rate")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    rate: last.data ? Number(last.data.rate) : Number(process.env["FALLBACK_USD_IDR"] || 16000),
    fresh: false,
  };
}

async function toIdr(amount: number, currency: string, rate?: number): Promise<number> {
  if (currency !== "USD") return r2(amount);
  return r2(amount * (rate ?? (await getUsdIdr())));
}

/* ---------------- Lookups ---------------- */
/** Escape LIKE/ILIKE wildcards (`%`, `_`) and the escape char `\\` so user input matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Pure, deterministic name resolution: exact (case/whitespace-insensitive) match first, then a partial
 * match ranked prefix > word-start > substring, then shortest name, then name and id as tie-breakers.
 */
export function pickBestNameMatch<T extends { id: string; name: string }>(
  rows: readonly T[],
  query: string | null | undefined,
): T | null {
  const q = normName(query ?? "");
  if (!q) return null;
  const byNameThenId = (a: T, b: T) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const exact = rows.filter((r) => normName(r.name) === q).sort(byNameThenId);
  if (exact[0]) return exact[0];
  const rank = (n: string) => (n.startsWith(q) ? 0 : (" " + n).includes(" " + q) ? 1 : 2);
  const partial = rows
    .map((r) => ({ r, n: normName(r.name) }))
    .filter((x) => x.n.includes(q))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.n.length - b.n.length || byNameThenId(a.r, b.r));
  return partial[0]?.r ?? null;
}

export async function ensureCategory(name: string, kind: "income" | "expense"): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  const rows = must(
    await db()
      .from("categories")
      .select("id, name")
      .eq("kind", kind)
      .ilike("name", escapeLike(clean)),
  );
  const found = rows
    .filter((r) => normName(r.name) === normName(clean))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (found) return found.id;
  const created = must(
    await db().from("categories").insert({ name: clean, kind }).select("id").single(),
  );
  return created.id;
}

export async function findAccount(name?: string | null): Promise<string | null> {
  const q = (name ?? "").trim().replace(/\s+/g, " ");
  if (!q) return null;
  const rows = must(
    await db()
      .from("accounts")
      .select("id, name")
      .ilike("name", `%${escapeLike(q)}%`),
  );
  return pickBestNameMatch(rows, q)?.id ?? null;
}

/* ---------------- Transactions ---------------- */
function normalizeTx(input: TransactionInput) {
  const { fee: _fee, receipt_paths, ...rest } = input;
  return {
    ...rest,
    // v12: banyak foto → receipt_path selalu = foto pertama (kompatibel dengan versi lama).
    ...(receipt_paths !== undefined ? receiptColumns(receipt_paths ?? []) : {}),
    category_id: input.kind === "transfer" ? null : input.category_id,
    to_account_id: input.kind === "transfer" ? input.to_account_id : null,
  };
}

// Kolom receipt_path mungkin belum ada di database user (migrasi opsional).
// Jika PostgREST menolak kolomnya, ulangi tanpa kolom itu agar fitur lain tetap jalan.
function isMissingReceiptColumn(err: { message?: string } | null) {
  return !!err?.message && err.message.includes("receipt_path");
}
// receipt_paths (v12, banyak foto) dicek lebih dulu karena namanya mengandung "receipt_path".
function isMissingReceiptPathsColumn(err: { message?: string } | null) {
  return !!err?.message && err.message.includes("receipt_paths");
}
// external_id (v7) juga opsional: bila kolom belum ada, simpan tanpa kolom itu.
function isMissingExternalColumn(err: { message?: string } | null) {
  return !!err?.message && err.message.includes("external_id");
}

async function insertTxRow(row: TxInsert): Promise<TxRow> {
  let current = row;
  for (let i = 0; i < 4; i++) {
    const res = await db().from("transactions").insert(current).select().single();
    if (res.error && isMissingReceiptPathsColumn(res.error) && "receipt_paths" in current) {
      const { receipt_paths: _drop, ...rest } = current;
      current = rest;
      continue;
    }
    if (res.error && isMissingReceiptColumn(res.error) && "receipt_path" in current) {
      const { receipt_path: _drop, ...rest } = current;
      current = rest;
      continue;
    }
    if (res.error && isMissingExternalColumn(res.error) && "external_id" in current) {
      const { external_id: _drop, ...rest } = current;
      current = rest;
      continue;
    }
    return must(res);
  }
  return must(await db().from("transactions").insert(current).select().single());
}

export async function insertTransaction(
  input: TransactionInput,
  raw?: unknown,
  extra?: { external_id?: string | null },
) {
  await (await import("./demo.server")).assertDemoCapacity("transactions");
  const tx = await insertTxRow({
    ...normalizeTx(input),
    amount_idr: await toIdr(input.amount, input.currency),
    raw: (raw ?? null) as Json,
    ...(extra?.external_id ? { external_id: extra.external_id } : {}),
  });
  const fee = Number(input.fee) || 0;
  if (fee > 0 && input.kind !== "income") {
    await insertTxRow({
      kind: "expense",
      amount: fee,
      currency: input.currency,
      amount_idr: await toIdr(fee, input.currency),
      account_id: input.account_id,
      to_account_id: null,
      category_id: await ensureCategory(FEE_CATEGORY, "expense"),
      description: `${input.kind === "transfer" ? "Biaya transfer" : "Biaya admin"}${input.description ? `: ${input.description}` : ""}`,
      merchant: null,
      occurred_at: input.occurred_at,
      source: input.source,
      items: null,
      notes: `[fee:${tx.id}]`,
      receipt_path: null,
      raw: null,
    });
  }
  await logActivity("transaction.create", "transactions", {
    kind: input.kind,
    amount: input.amount,
    currency: input.currency,
    description: input.description ?? null,
    source: input.source,
  });
  return tx;
}

export async function updateTransaction(id: string, input: TransactionInput) {
  let row = { ...normalizeTx(input), amount_idr: await toIdr(input.amount, input.currency) };
  let res = await db().from("transactions").update(row).eq("id", id).select().single();
  if (res.error && isMissingReceiptPathsColumn(res.error) && "receipt_paths" in row) {
    const { receipt_paths: _drop, ...rest } = row;
    row = rest;
    res = await db().from("transactions").update(row).eq("id", id).select().single();
  }
  let data: TxRow;
  if (res.error && isMissingReceiptColumn(res.error)) {
    const { receipt_path: _drop, ...fallback } = row;
    data = must(await db().from("transactions").update(fallback).eq("id", id).select().single());
  } else {
    data = must(res);
  }
  await logActivity("transaction.update", "transactions", {
    kind: input.kind,
    amount: input.amount,
    currency: input.currency,
    description: input.description ?? null,
  });
  return data;
}

/**
 * Account used by the bot when none is mentioned: the account chosen in Settings (v14) when it
 * still exists, else env BOT_DEFAULT_ACCOUNT matched by name.
 */
export async function defaultAccountId(): Promise<string | null> {
  const s = await getAppSettings();
  if (s.bot_default_account_id) {
    const r = await db()
      .from("accounts")
      .select("id")
      .eq("id", s.bot_default_account_id)
      .maybeSingle();
    if (r.data) return r.data.id;
  }
  return findAccount(s.bot_default_account_name);
}

export async function findByExternalId(externalId: string): Promise<TxRow | null> {
  const r = await db()
    .from("transactions")
    .select("*")
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();
  if (r.error) return null; // kolom belum ada (v7 belum dijalankan) → anggap tidak ada
  return r.data ?? null;
}

export async function createFromExternal(t: ExternalTx) {
  if (t.external_id) {
    const dup = await findByExternalId(t.external_id);
    if (dup)
      return {
        transaction: dup,
        duplicate: true,
        message: "ℹ️ Transaksi ini sudah tercatat sebelumnya.",
      };
  }
  // "Makan (expense)" → "Makan": jangan pernah membuat kategori dengan akhiran jenis.
  const catName = t.category?.replace(/\s*\((income|expense)\)\s*$/i, "").trim() || null;
  const category_id =
    t.kind !== "transfer" && catName ? await ensureCategory(catName, t.kind) : null;
  const botSource = t.source === "telegram" || t.source === "whatsapp" || t.source === "ocr";
  const input: TransactionInput = {
    kind: t.kind,
    amount: t.amount,
    currency: t.currency,
    account_id: (await findAccount(t.account)) ?? (botSource ? await defaultAccountId() : null),
    to_account_id: t.kind === "transfer" ? await findAccount(t.to_account) : null,
    category_id,
    description: t.description ?? null,
    merchant: t.merchant ?? null,
    occurred_at: t.date ?? today(),
    source: t.source,
    items: t.items ?? null,
    notes: t.notes ?? null,
    receipt_path: t.receipt_path ?? null,
  };
  let tx: TxRow;
  try {
    tx = await insertTransaction(input, t.raw, { external_id: t.external_id ?? null });
  } catch (e) {
    // Balapan dua request dengan external_id sama → unique violation; kembalikan yang sudah ada.
    const dup =
      t.external_id && /duplicate key|23505/i.test(String((e as Error).message))
        ? await findByExternalId(t.external_id)
        : null;
    if (dup)
      return {
        transaction: dup,
        duplicate: true,
        message: "ℹ️ Transaksi ini sudah tercatat sebelumnya.",
      };
    throw e;
  }
  const label =
    t.kind === "income" ? "Pemasukan" : t.kind === "expense" ? "Pengeluaran" : "Transfer";
  const amountText = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: t.currency,
    maximumFractionDigits: t.currency === "USD" ? 2 : 0,
  }).format(t.amount);
  const message = `✅ Tercatat: ${label} ${amountText}${catName ? ` • ${catName}` : ""}${t.description || t.merchant ? ` • ${t.description ?? t.merchant}` : ""}`;
  return { transaction: tx, duplicate: false, message };
}

/**
 * v18 data scope: the account ids a member may see. `null`/`undefined` = every account (owner,
 * bot, n8n) — the unscoped behaviour is unchanged. Server fns pass `allowedAccountIds(access)`;
 * the scope is never taken from client input.
 */
export type Scope = readonly string[] | null | undefined;

export type TxFilters = {
  month?: string | undefined;
  kind?: string | undefined;
  search?: string | undefined;
  category_id?: string | undefined;
  account_id?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: "occurred_at" | "amount" | "description" | undefined;
  direction?: "asc" | "desc" | undefined;
};

// v12: items_search (generated, lower(items::text)) lets search match receipt item names.
// Once PostgREST reports it missing (v12 not run), search skips it for this server instance.
let itemsSearchMissing = false;
function retryWithoutItemsSearch(res: Res, f: TxFilters): boolean {
  if (!f.search || itemsSearchMissing || !res.error?.message.includes("items_search")) return false;
  itemsSearchMissing = true;
  return true;
}

function applyTxFilters(q: any, f: TxFilters, scope?: Scope) {
  if (scope) q = q.or(txScopeFilter(scope));
  if (f.month) {
    const { start, end } = monthRange(f.month);
    q = q.gte("occurred_at", start).lt("occurred_at", end);
  }
  if (f.kind) q = q.eq("kind", f.kind);
  if (f.category_id) q = q.eq("category_id", f.category_id);
  if (f.account_id) q = q.or(`account_id.eq.${f.account_id},to_account_id.eq.${f.account_id}`);
  if (f.search) {
    const s = f.search.replace(/[%,()*]/g, "").trim();
    if (s)
      q = q.or(
        `description.ilike.%${s}%,merchant.ilike.%${s}%,notes.ilike.%${s}%` +
          (itemsSearchMissing ? "" : `,items_search.ilike.%${s.toLowerCase()}%`),
      );
  }
  return q;
}

const TX_LIST_SELECT =
  "*, category:categories(id,name,color), account:accounts!transactions_account_id_fkey(id,name), to_account:accounts!transactions_to_account_id_fkey(id,name)";

function orderedTxList(f: TxFilters) {
  return db()
    .from("transactions")
    .select(TX_LIST_SELECT)
    .order(f.sort ?? "occurred_at", {
      ascending: (f.direction ?? "desc") === "asc",
      nullsFirst: false,
    })
    .order("created_at", { ascending: false });
}

export async function listTransactions(f: TxFilters, scope?: Scope) {
  const limit = f.limit ?? 500;
  const offset = f.offset ?? 0;
  const run = () => applyTxFilters(orderedTxList(f).range(offset, offset + limit - 1), f, scope);
  const res = await run();
  return must(retryWithoutItemsSearch(res, f) ? await run() : res);
}

export async function countTransactions(f: TxFilters, scope?: Scope) {
  const run = () =>
    applyTxFilters(
      db().from("transactions").select("id", { count: "exact", head: true }),
      f,
      scope,
    );
  let res = await run();
  if (retryWithoutItemsSearch(res, f)) res = await run();
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

export async function exportCsv(month?: string, scope?: Scope, mask?: (r: TxListRow) => TxListRow) {
  // Same order/filters as listTransactions, paged past PostgREST's 1000-row cap (id = stable tie-break).
  const f: TxFilters = { month };
  const fetched = must<TxListRow[]>(
    await fetchAll<TxListRow>(
      (from, to) => applyTxFilters(orderedTxList(f).order("id"), f, scope).range(from, to),
      {
        hardCap: 10000,
      },
    ),
  );
  const rows = mask ? fetched.map(mask) : fetched;
  const head = [
    "Tanggal",
    "Jenis",
    "Kategori",
    "Akun",
    "Ke Akun",
    "Deskripsi",
    "Merchant",
    "Jumlah",
    "Mata Uang",
    "Jumlah IDR",
    "Sumber",
    "Catatan",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.occurred_at,
      r.kind,
      r.category?.name,
      r.account?.name,
      r.to_account?.name,
      r.description,
      r.merchant,
      r.amount,
      r.currency,
      r.amount_idr,
      r.source,
      r.notes,
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}

/* ---------------- Aggregation (v9 SQL functions, JS fallback) ---------------- */
type AggTx = Pick<TxRow, "kind" | "amount_idr" | "occurred_at" | "category_id"> & {
  category: CatRef;
};

/** Non-transfer transactions in [start, end) for the JS fallback (start null = from the beginning). */
async function fetchAggTx(
  start: string | null,
  end: string,
  opts: { kind?: "income" | "expense"; hardCap?: number; scope?: Scope } = {},
): Promise<AggTx[]> {
  return must<AggTx[]>(
    await fetchAll(
      (from, to) => {
        let q = db()
          .from("transactions")
          .select("kind, amount_idr, occurred_at, category_id, category:categories(name,color)")
          .lt("occurred_at", end)
          .neq("kind", "transfer");
        if (start) q = q.gte("occurred_at", start);
        if (opts.kind) q = q.eq("kind", opts.kind);
        // Members: income/expense count toward the wallet they were recorded on.
        if (opts.scope) q = q.in("account_id", scopeIds(opts.scope));
        return q.order("id").range(from, to);
      },
      opts.hardCap ? { hardCap: opts.hardCap } : {},
    ),
  );
}
type AggSource = () => Promise<AggTx[]>;

/**
 * v9 SQL aggregates are global; a scoped (member) request always uses the JS path, whose source
 * fetch is filtered by account (`fetchAggTx(..., { scope })`), so totals never include other
 * wallets.
 */
async function monthTotals(
  start: string,
  end: string,
  fb: AggSource,
  scope?: Scope,
): Promise<MonthKindTotal[]> {
  if (scope) return normalizeTotals(sumMonthKind(await fb()));
  const r = await sqlOrFallback(
    () => db().rpc("dk_month_totals", { p_start: start, p_end: end }),
    async () => sumMonthKind(await fb()),
  );
  return normalizeTotals(r.rows);
}

async function categoryTotals(
  start: string,
  end: string,
  kind: "income" | "expense",
  fb: AggSource,
  scope?: Scope,
): Promise<CategoryTotal[]> {
  if (scope) return normalizeTotals(sumCategories((await fb()).filter((t) => t.kind === kind)));
  const r = await sqlOrFallback(
    () => db().rpc("dk_category_totals", { p_start: start, p_end: end, p_kind: kind }),
    async () => sumCategories((await fb()).filter((t) => t.kind === kind)),
  );
  return normalizeTotals(r.rows);
}

async function monthCategoryTotals(
  start: string,
  end: string,
  fb: AggSource,
  scope?: Scope,
): Promise<MonthCategoryTotal[]> {
  if (scope)
    return normalizeTotals(sumMonthCategories((await fb()).filter((t) => t.kind === "expense")));
  const r = await sqlOrFallback(
    () => db().rpc("dk_month_category_totals", { p_start: start, p_end: end }),
    async () => sumMonthCategories((await fb()).filter((t) => t.kind === "expense")),
  );
  return normalizeTotals(r.rows);
}

async function monthlyNetBefore(end: string, fb: AggSource): Promise<MonthNet[]> {
  const r = await sqlOrFallback(
    () => db().rpc("dk_monthly_net", { p_end: end }),
    async () => sumMonthlyNet(await fb()),
  );
  return normalizeNet(r.rows);
}

/* ---------------- Budgets ---------------- */
export async function computeBudgets(month: string) {
  const { start, end } = monthRange(month);
  const [budgetsRes, cats] = await Promise.all([
    db().from("budgets").select("*, category:categories(id,name,color)"),
    categoryTotals(start, end, "expense", () => fetchAggTx(start, end, { kind: "expense" })),
  ]);
  const budgets = must(budgetsRes);
  const spent = spentByCategory(cats);
  // v11 rollover: carry from previous months (column absent before v11 → no rollover).
  const rolling = budgets
    .filter((b) => b.rollover === true)
    .map((b) => ({ ...b, amount: Number(b.amount) }));
  const carries = rolling.length
    ? await (await import("./budget.server")).rolloverCarries(month, rolling)
    : new Map<string, number>();
  return budgets.map((b) => {
    const amount = Number(b.amount);
    const s = spent.get(b.category_id) ?? 0;
    const rollover = b.rollover === true;
    const carry = rollover ? (carries.get(b.id) ?? 0) : 0;
    const effective = r2(amount + carry);
    return {
      id: b.id as string,
      category_id: b.category_id as string,
      category: (b.category?.name ?? "-") as string,
      color: (b.category?.color ?? null) as string | null,
      amount,
      alert_percent: Number(b.alert_percent),
      spent: s,
      percent: rollover ? budgetPercent(s, effective, amount) : amount ? (s / amount) * 100 : 0,
      rollover,
      carry,
      effective,
    };
  });
}

/* ---------------- Debts ---------------- */
export async function computeDebts() {
  const [debtsRes, paysRes] = await Promise.all([
    db().from("debts").select("*").order("created_at"),
    db().from("debt_payments").select("*").order("installment_no"),
  ]);
  const debts = must(debtsRes);
  const pays = must(paysRes);
  return debts.map((d) => {
    const payments = pays.filter((p) => p.debt_id === d.id);
    const paid = payments.length;
    const total = Number(d.total_installments);
    const remaining = Math.max(0, total - paid);
    const next_due =
      remaining > 0 && d.status === "active"
        ? addMonthsKeepDay(String(d.start_date).slice(0, 7) + "-01", paid, Number(d.due_day))
        : null;
    return {
      ...d,
      total_amount: Number(d.total_amount),
      installment_amount: Number(d.installment_amount),
      paid_count: paid,
      remaining_count: remaining,
      remaining_amount: remaining * Number(d.installment_amount),
      paid_amount: payments.reduce((a, p) => a + Number(p.amount), 0),
      next_due,
      payments: payments.map((p) => ({
        id: p.id as string,
        installment_no: p.installment_no as number,
        amount: Number(p.amount),
        paid_at: p.paid_at as string,
      })),
    };
  });
}

export async function payDebt(debtId: string, accountId: string | null, date: string | null) {
  const d = must(await db().from("debts").select("*").eq("id", debtId).single());
  const { count } = await db()
    .from("debt_payments")
    .select("id", { count: "exact", head: true })
    .eq("debt_id", debtId);
  const paid = count ?? 0;
  if (paid >= d.total_installments) throw new Error("Hutang ini sudah lunas.");
  const cat = await ensureCategory("Cicilan & Hutang", "expense");
  const tx = await insertTransaction({
    kind: "expense",
    amount: Number(d.installment_amount),
    currency: d.currency,
    account_id: accountId ?? d.account_id ?? null,
    to_account_id: null,
    category_id: cat,
    description: `Cicilan ${d.name} ke-${paid + 1}/${d.total_installments}`,
    merchant: d.provider ?? null,
    occurred_at: date ?? today(),
    source: "web",
    items: null,
    notes: null,
    receipt_path: null,
  });
  must(
    await db()
      .from("debt_payments")
      .insert({
        debt_id: debtId,
        installment_no: paid + 1,
        amount: d.installment_amount,
        paid_at: date ?? today(),
        transaction_id: tx.id,
      }),
  );
  if (paid + 1 >= d.total_installments)
    await db().from("debts").update({ status: "paid_off" }).eq("id", debtId);
  await logActivity("debt.pay", "debts", {
    name: d.name,
    amount: Number(d.installment_amount),
    currency: d.currency,
    installment: paid + 1,
  });
  return { ok: true };
}

export async function deleteDebtPayment(id: string) {
  const p = must(await db().from("debt_payments").select("*").eq("id", id).single());
  const d = await db().from("debts").select("name, currency").eq("id", p.debt_id).maybeSingle();
  must(await db().from("debt_payments").delete().eq("id", id));
  if (p.transaction_id) await db().from("transactions").delete().eq("id", p.transaction_id);
  await db().from("debts").update({ status: "active" }).eq("id", p.debt_id);
  return {
    name: d.data?.name ?? null,
    amount: Number(p.amount),
    currency: d.data?.currency ?? "IDR",
    installment: p.installment_no,
  };
}

/* ---------------- Goals ---------------- */
/**
 * Deposit (amount > 0) or withdraw (amount < 0) on a savings goal. When the goal has a savings
 * account (v8) and another account is chosen, the money moves as a transfer between them;
 * otherwise only saved_amount changes. Never creates an expense.
 */
export async function addGoalFunds(
  goalId: string,
  amount: number,
  accountId: string | null,
  date: string | null,
) {
  const g = must(await db().from("goals").select("*").eq("id", goalId).single());
  const plan = planGoalFunds({
    goalId,
    goalName: g.name,
    goalAccountId: g.account_id ?? null,
    saved: Number(g.saved_amount),
    amount,
    accountId,
    date: date ?? today(),
  });
  let names: Record<string, string> = {};
  if (plan.transfer) {
    const t = plan.transfer;
    const accs = must(
      await db()
        .from("accounts")
        .select("id, name, currency")
        .in("id", [t.account_id, t.to_account_id]),
    );
    if (accs.length < 2) throw new Error("Akun tidak ditemukan");
    names = Object.fromEntries(accs.map((a) => [a.id, a.name]));
    const currency = accs.find((a) => a.id === t.account_id)?.currency === "USD" ? "USD" : "IDR";
    await insertTransaction({
      kind: "transfer",
      amount: t.amount,
      currency,
      account_id: t.account_id,
      to_account_id: t.to_account_id,
      category_id: null,
      description: t.description,
      merchant: null,
      occurred_at: t.occurred_at,
      source: "web",
      items: null,
      notes: t.notes,
      receipt_path: null,
    });
  }
  must(await db().from("goals").update({ saved_amount: plan.newSaved }).eq("id", goalId));
  await logActivity("goal.funds", "goals", {
    name: g.name,
    amount: plan.moved,
    currency: "IDR",
    direction: plan.direction,
    from: plan.transfer ? (names[plan.transfer.account_id] ?? null) : null,
    to: plan.transfer ? (names[plan.transfer.to_account_id] ?? null) : null,
  });
  return { ok: true, saved: plan.newSaved, moved: plan.moved, transfer: !!plan.transfer };
}

/* ---------------- Subscriptions ---------------- */
export async function paySubscription(id: string, accountId: string | null, date: string | null) {
  const s = must(await db().from("subscriptions").select("*").eq("id", id).single());
  const cat = s.category_id ?? (await ensureCategory("Langganan", "expense"));
  const total = withTax(Number(s.amount), s.tax_percent);
  await insertTransaction({
    kind: "expense",
    amount: total,
    currency: s.currency,
    account_id: accountId ?? s.account_id ?? null,
    to_account_id: null,
    category_id: cat,
    description: `Langganan ${s.name}`,
    merchant: s.name,
    occurred_at: date ?? today(),
    source: "web",
    items: null,
    notes: null,
    receipt_path: null,
  });
  const next = addMonthsKeepDay(s.next_due, s.cycle === "yearly" ? 12 : 1);
  must(await db().from("subscriptions").update({ next_due: next }).eq("id", id));
  await logActivity("subscription.pay", "subscriptions", {
    name: s.name,
    amount: total,
    currency: s.currency,
  });
  return { ok: true, next_due: next };
}

/* ---------------- Reminders ---------------- */
export type Reminder = {
  type: "debt" | "subscription" | "budget" | "fee" | "recurring";
  id: string;
  title: string;
  amount: number;
  currency: string;
  amount_idr: number;
  due_date: string;
  days_left: number;
  overdue: boolean;
};

type MaybePromise<T> = T | Promise<T>;
/** Pre-fetched inputs so a caller that already loads them (dashboard) avoids duplicate queries. */
export type ReminderInputs = {
  /** Caller already ran applyMonthlyFees() for this request. */
  skipFees?: boolean;
  rate?: MaybePromise<number>;
  debts?: MaybePromise<Awaited<ReturnType<typeof computeDebts>>>;
  /** Budgets for the current month (today().slice(0, 7)). */
  budgets?: MaybePromise<Awaited<ReturnType<typeof computeBudgets>>>;
};

export async function computeReminders(days = 30, pre: ReminderInputs = {}): Promise<Reminder[]> {
  if (!pre.skipFees) {
    await applyMonthlyFees();
    await applyRecurringLazy();
  }
  const t = today();
  const limit = addDays(t, days);
  const [rate, debts, subsRes, accRes, budgets] = await Promise.all([
    pre.rate ?? getUsdIdr(),
    pre.debts ?? computeDebts(),
    db().from("subscriptions").select("*").eq("active", true).lte("next_due", limit),
    db().from("accounts").select("*").eq("archived", false),
    pre.budgets ?? computeBudgets(t.slice(0, 7)),
  ]);
  const out: Reminder[] = [];
  for (const d of debts) {
    if (!d.next_due || d.next_due > limit) continue;
    out.push({
      type: "debt",
      id: d.id,
      title: `Cicilan ${d.name} (${d.paid_count + 1}/${d.total_installments})`,
      amount: d.installment_amount,
      currency: d.currency,
      amount_idr: await toIdr(d.installment_amount, d.currency, rate),
      due_date: d.next_due,
      days_left: diffDays(t, d.next_due),
      overdue: d.next_due < t,
    });
  }
  const subs = must(subsRes);
  for (const s of subs) {
    const amt = withTax(Number(s.amount), s.tax_percent);
    out.push({
      type: "subscription",
      id: s.id,
      title: `Langganan ${s.name} (${s.cycle === "yearly" ? "tahunan" : "bulanan"})`,
      amount: amt,
      currency: s.currency,
      amount_idr: await toIdr(amt, s.currency, rate),
      due_date: s.next_due,
      days_left: diffDays(t, s.next_due),
      overdue: s.next_due < t,
    });
  }
  for (const a of must(accRes)) {
    if (!(Number(a.monthly_fee) > 0)) continue;
    let due = feeDate(t.slice(0, 7), Number(a.monthly_fee_day) || 1);
    if (due < t) due = feeDate(shiftMonth(t.slice(0, 7), 1), Number(a.monthly_fee_day) || 1);
    if (due > limit) continue;
    const amt = Number(a.monthly_fee);
    out.push({
      type: "fee",
      id: a.id,
      title: `Biaya bulanan ${a.name} (otomatis)`,
      amount: amt,
      currency: a.currency,
      amount_idr: await toIdr(amt, a.currency, rate),
      due_date: due,
      days_left: diffDays(t, due),
      overdue: false,
    });
  }
  for (const b of budgets) {
    if (b.percent >= b.alert_percent) {
      out.push({
        type: "budget",
        id: b.id,
        title: `Budget ${b.category} terpakai ${Math.round(b.percent)}%`,
        amount: b.spent,
        currency: "IDR",
        amount_idr: b.spent,
        due_date: t,
        days_left: 0,
        overdue: b.percent >= 100,
      });
    }
  }
  // v10: manual recurring items (auto_post off) — empty when the table does not exist yet.
  const { recurringReminders } = await import("./recurring.server");
  out.push(...(await recurringReminders(t, limit, rate)));
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/** v10: post due auto recurring transactions (never throws; no-op before schema v10). */
export async function applyRecurringLazy(): Promise<number> {
  const { applyRecurring } = await import("./recurring.server");
  return applyRecurring();
}

export function remindersText(list: Reminder[]): string {
  if (!list.length) return "🎉 Tidak ada tagihan dalam waktu dekat.";
  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "USD" ? 2 : 0,
    }).format(n);
  const lines = list.map((r) => {
    const when =
      r.type === "budget"
        ? ""
        : r.overdue
          ? ` — TERLAMBAT ${-r.days_left} hari`
          : r.days_left === 0
            ? " — HARI INI"
            : ` — ${r.days_left} hari lagi (${r.due_date})`;
    return `• ${r.title}: ${fmt(r.amount, r.currency)}${when}`;
  });
  return `🔔 Pengingat Keuangan\n${lines.join("\n")}`;
}

/* ---------------- Dashboard ---------------- */
/** Record due monthly account fees once per month (idempotent via notes marker). */
export async function applyMonthlyFees(): Promise<number> {
  await getAppSettings(); // warm the settings cache so today() uses the Settings time zone
  const t = today();
  // Both reads are independent; fetch them together to save a round trip.
  const [accRes, existing] = await Promise.all([
    db().from("accounts").select("*"),
    db()
      .from("transactions")
      .select("notes")
      .like("notes", `[auto:monthly_fee:%:${t.slice(0, 7)}]`),
  ]);
  if (accRes.error) return 0;
  const candidates = (accRes.data ?? []).filter((a) => Number(a.monthly_fee) > 0);
  if (!candidates.length) return 0;
  const recorded = new Set<string>((existing.data ?? []).map((r) => String(r.notes)));
  const due = dueMonthlyFees(candidates, t, recorded);
  if (!due.length) return 0;
  const cat = await ensureCategory(FEE_CATEGORY, "expense");
  for (const d of due) {
    const a = d.account;
    await insertTxRow({
      kind: "expense",
      amount: Number(a.monthly_fee),
      currency: a.currency,
      amount_idr: await toIdr(Number(a.monthly_fee), a.currency),
      account_id: a.id,
      to_account_id: null,
      category_id: cat,
      description: `Biaya bulanan ${a.name}`,
      merchant: a.name,
      occurred_at: d.date,
      source: "web",
      items: null,
      notes: d.marker,
      receipt_path: null,
      raw: null,
    });
    await logActivity("transaction.create", "transactions", {
      kind: "expense",
      amount: Number(a.monthly_fee),
      currency: a.currency,
      description: `Biaya bulanan ${a.name}`,
      source: "auto",
    });
  }
  return due.length;
}

export async function computeDashboard(month: string) {
  await applyMonthlyFees();
  await applyRecurringLazy();
  const { start, end } = monthRange(month);
  const trendStart = monthRange(shiftMonth(month, -5)).start;
  const curMonth = today().slice(0, 7);
  // applyMonthlyFees ran above, so everything below can load in one parallel wave; debts, rate and
  // the current month's budgets are shared with computeReminders instead of being fetched twice.
  const rateP = getUsdIdr();
  const debtsP = computeDebts();
  const budgetsP = computeBudgets(month);
  const curBudgetsP = month === curMonth ? budgetsP : computeBudgets(curMonth);
  const remindersP = computeReminders(14, {
    skipFees: true,
    rate: rateP,
    debts: debtsP,
    budgets: curBudgetsP,
  });
  // One shared JS fallback fetch (6 months, no transfers) when the v9 SQL functions are missing.
  const fb = once(() => fetchAggTx(trendStart, end));
  const [
    totals,
    monthCats,
    trendCats,
    balRes,
    goalsRes,
    subsRes,
    recentRes,
    rate,
    debts,
    budgets,
    reminders,
  ] = await Promise.all([
    monthTotals(trendStart, end, fb),
    categoryTotals(start, end, "expense", async () =>
      (await fb()).filter((t) => String(t.occurred_at) >= start),
    ),
    monthCategoryTotals(trendStart, end, fb),
    db().from("account_balances").select("*").eq("archived", false),
    db().from("goals").select("*").order("created_at"),
    db().from("subscriptions").select("*").eq("active", true),
    db()
      .from("transactions")
      .select(
        "*, category:categories(name,color), account:accounts!transactions_account_id_fkey(name)",
      )
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    rateP,
    debtsP,
    budgetsP,
    remindersP,
  ]);
  const income = kindTotal(totals, "income", month);
  const expense = kindTotal(totals, "expense", month);
  const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const categoryTrend = topCategoryTrend(trendMonths, trendCats);
  const balances = must(balRes).map((b) => ({
    ...b,
    balance: Number(b.balance),
    balance_idr: b.currency === "USD" ? Number(b.balance) * rate : Number(b.balance),
  }));
  const debtOutstandingIdr = debts
    .filter((d) => d.status === "active")
    .reduce(
      (a, d) => a + (d.currency === "USD" ? d.remaining_amount * rate : d.remaining_amount),
      0,
    );
  const subsMonthlyIdr = must(subsRes).reduce((a, s) => {
    const v = withTax(Number(s.amount), s.tax_percent) * (s.currency === "USD" ? rate : 1);
    return a + (s.cycle === "yearly" ? v / 12 : v);
  }, 0);
  const feesIdr = monthCats.filter((c) => c.name === FEE_CATEGORY).reduce((a, c) => a + c.total, 0);
  return {
    month,
    feesIdr,
    usdIdr: rate,
    income,
    expense,
    net: income - expense,
    byCategory: categorySlices(monthCats),
    trend: monthSeries(trendMonths, totals),
    categoryTrend,
    balances,
    totalBalanceIdr: balances.reduce((a, b) => a + b.balance_idr, 0),
    debtOutstandingIdr,
    subsMonthlyIdr,
    budgets,
    reminders: reminders.slice(0, 6),
    recent: must(recentRes),
    goals: must(goalsRes).map((g) => ({
      ...g,
      target_amount: Number(g.target_amount),
      saved_amount: Number(g.saved_amount),
    })),
  };
}

/**
 * Member dashboard (v18): same shape as computeDashboard, computed only over the permitted
 * wallets (JS aggregation). Debts, goals, budgets, subscriptions and reminders are admin-only
 * and come back empty; monthly fees/recurring are not applied from a member request.
 */
export async function computeMemberDashboard(
  month: string,
  scope: readonly string[],
  mask: <T extends Record<string, unknown>>(row: T) => T,
) {
  const { start, end } = monthRange(month);
  const trendStart = monthRange(shiftMonth(month, -5)).start;
  const ids = scopeIds(scope);
  const fb = once(() => fetchAggTx(trendStart, end, { scope }));
  const [totals, monthCats, trendCats, balRes, recentRes, rate] = await Promise.all([
    monthTotals(trendStart, end, fb, scope),
    categoryTotals(
      start,
      end,
      "expense",
      async () => (await fb()).filter((t) => String(t.occurred_at) >= start),
      scope,
    ),
    monthCategoryTotals(trendStart, end, fb, scope),
    db().from("account_balances").select("*").eq("archived", false).in("id", ids),
    db()
      .from("transactions")
      .select(
        "*, category:categories(name,color), account:accounts!transactions_account_id_fkey(id,name), to_account:accounts!transactions_to_account_id_fkey(id,name)",
      )
      .or(txScopeFilter(ids))
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    getUsdIdr(),
  ]);
  const income = kindTotal(totals, "income", month);
  const expense = kindTotal(totals, "expense", month);
  const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const balances = must(balRes).map((b) => ({
    ...b,
    balance: Number(b.balance),
    balance_idr: b.currency === "USD" ? Number(b.balance) * rate : Number(b.balance),
  }));
  const feesIdr = monthCats.filter((c) => c.name === FEE_CATEGORY).reduce((a, c) => a + c.total, 0);
  return {
    month,
    feesIdr,
    usdIdr: rate,
    income,
    expense,
    net: income - expense,
    byCategory: categorySlices(monthCats),
    trend: monthSeries(trendMonths, totals),
    categoryTrend: topCategoryTrend(trendMonths, trendCats),
    balances,
    totalBalanceIdr: balances.reduce((a, b) => a + b.balance_idr, 0),
    debtOutstandingIdr: 0,
    subsMonthlyIdr: 0,
    budgets: [] as Awaited<ReturnType<typeof computeBudgets>>,
    reminders: [] as Reminder[],
    recent: must(recentRes).map((r) => mask(r as Record<string, unknown>)),
    goals: [] as { id: string; name: string; target_amount: number; saved_amount: number }[],
    scoped: true as const,
  };
}

export async function summaryText(month: string): Promise<string> {
  const d = await computeDashboard(month);
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(n);
  const top = d.byCategory
    .slice(0, 5)
    .map((c) => `  • ${c.name}: ${fmt(c.value)}`)
    .join("\n");
  return `📊 Ringkasan ${month}\nPemasukan: ${fmt(d.income)}\nPengeluaran: ${fmt(d.expense)}\nSelisih: ${fmt(d.net)}\nTotal saldo: ${fmt(d.totalBalanceIdr)}\nSisa hutang: ${fmt(d.debtOutstandingIdr)}${top ? `\nPengeluaran terbesar:\n${top}` : ""}`;
}

/** Category & account names for AI prompts / quick parser (names only, split by kind). */
export async function parseContext(): Promise<import("./ocr.server").ParseContext> {
  const [cats, accs] = await Promise.all([
    db().from("categories").select("name, kind").order("name"),
    db().from("accounts").select("name").eq("archived", false).order("name"),
  ]);
  const rows = must(cats);
  return {
    income: rows.filter((r) => r.kind === "income").map((r) => String(r.name)),
    expense: rows.filter((r) => r.kind === "expense").map((r) => String(r.name)),
    accounts: (accs.data ?? []).map((a) => String(a.name)),
  };
}

/* ---------------- Yearly recap ---------------- */
export async function computeYearly(year: string) {
  const start = `${year}-01-01`;
  const end = `${Number(year) + 1}-01-01`;
  const fb = once(() => fetchAggTx(start, end));
  const [totals, cats] = await Promise.all([
    monthTotals(start, end, fb),
    categoryTotals(start, end, "expense", fb),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const income = kindTotal(totals, "income");
  const expense = kindTotal(totals, "expense");
  return {
    year,
    income,
    expense,
    net: income - expense,
    avgIncome: income / 12,
    avgExpense: expense / 12,
    months: monthSeries(months, totals),
    byCategory: categoriesByName(cats),
  };
}

/* ---------------- Email reminders (via n8n) ---------------- */
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function remindersEmail(list: Reminder[]): { subject: string; text: string; html: string } {
  const t = today();
  const subject = list.length
    ? `Pengingat Keuangan: ${list.length} tagihan (${t})`
    : `Tidak ada tagihan dekat (${t})`;
  const text = remindersText(list);
  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "USD" ? 2 : 0,
    }).format(n);
  const items = list
    .map((r) => {
      const when =
        r.type === "budget"
          ? "Peringatan budget"
          : r.overdue
            ? `Terlambat ${-r.days_left} hari`
            : r.days_left === 0
              ? "Hari ini"
              : `${r.days_left} hari lagi (${r.due_date})`;
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${escHtml(r.title)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${escHtml(fmt(r.amount, r.currency))}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${r.overdue ? "#c0392b" : "#666"}">${escHtml(when)}</td></tr>`;
    })
    .join("");
  const html = list.length
    ? `<div style="font-family:sans-serif;max-width:560px;margin:auto"><h2 style="color:#1d3b2f">Pengingat Keuangan</h2><table style="width:100%;border-collapse:collapse;font-size:14px">${items}</table><p style="color:#999;font-size:12px">Dikirim otomatis oleh Dompetku via n8n.</p></div>`
    : `<div style="font-family:sans-serif"><p>🎉 Tidak ada tagihan dalam waktu dekat.</p></div>`;
  return { subject, text, html };
}

/* ---------------- CSV import ---------------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

function parseAmount(s: string): number {
  const cleaned = s.replace(/[^\d.,-]/g, "");
  // "1.234.567,89" (id) or "1234567.89" (raw export)
  const n = cleaned.includes(",")
    ? Number(cleaned.replace(/\./g, "").replace(",", "."))
    : Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`jumlah "${s}" tidak valid`);
  return n;
}

/** Import CSV dengan format hasil ekspor (Tanggal, Jenis, Kategori, Akun, ...). */
export async function importCsv(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => head.indexOf(name);
  if (idx("tanggal") < 0 || idx("jenis") < 0 || idx("jumlah") < 0) {
    throw new Error(
      "Format CSV tidak dikenali. Gunakan file hasil ekspor dengan kolom: Tanggal, Jenis, Kategori, Akun, Jumlah, Mata Uang, …",
    );
  }
  type Parsed = {
    line: number;
    row: string[];
    kind: "income" | "expense" | "transfer";
    date: string;
    currency: "IDR" | "USD";
    amount: number;
    category: string | null;
    account: string | null;
    to_account: string | null;
    description: string | null;
    merchant: string | null;
    notes: string | null;
  };
  const items: Parsed[] = [];
  const errors: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.every((c) => !c.trim())) continue;
    try {
      const kind = r[idx("jenis")]?.trim() ?? "";
      if (kind !== "income" && kind !== "expense" && kind !== "transfer")
        throw new Error(`jenis "${kind}" tidak valid`);
      const date = r[idx("tanggal")]?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`tanggal "${date}" tidak valid`);
      const currency = (r[idx("mata uang")]?.trim().toUpperCase() || "IDR") as "IDR" | "USD";
      if (currency !== "IDR" && currency !== "USD")
        throw new Error(`mata uang "${currency}" tidak valid`);
      items.push({
        line: i + 1,
        row: r,
        kind,
        date,
        currency,
        amount: parseAmount(r[idx("jumlah")] ?? ""),
        category: r[idx("kategori")]?.trim() || null,
        account: r[idx("akun")]?.trim() || null,
        to_account: kind === "transfer" ? r[idx("ke akun")]?.trim() || null : null,
        description: r[idx("deskripsi")]?.trim() || null,
        merchant: r[idx("merchant")]?.trim() || null,
        notes: r[idx("catatan")]?.trim() || null,
      });
    } catch (e) {
      errors.push(`Baris ${i + 1}: ${e instanceof Error ? e.message : "gagal"}`);
    }
  }
  let imported = 0;
  let duplicates = 0;
  if (items.length) {
    const dates = items.map((i) => i.date);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const existing = must<DupRow[]>(
      await fetchAll(
        (from, to) =>
          db()
            .from("transactions")
            .select("occurred_at, kind, amount, currency, description")
            .gte("occurred_at", min)
            .lte("occurred_at", max)
            .order("id")
            .range(from, to),
        { hardCap: 50000 },
      ),
    );
    const seen = new Set(
      existing.map((t) =>
        dupKey({
          date: t.occurred_at,
          kind: t.kind,
          amount: Number(t.amount),
          currency: t.currency,
          description: t.description,
        }),
      ),
    );
    for (const it of items) {
      try {
        const key = dupKey({
          date: it.date,
          kind: it.kind,
          amount: it.amount,
          currency: it.currency,
          description: it.description,
        });
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        await createFromExternal({
          kind: it.kind,
          amount: it.amount,
          currency: it.currency,
          category: it.category,
          account: it.account,
          to_account: it.to_account,
          description: it.description,
          merchant: it.merchant,
          date: it.date,
          source: "web",
          notes: it.notes,
          raw: null,
        });
        imported++;
      } catch (e) {
        errors.push(`Baris ${it.line}: ${e instanceof Error ? e.message : "gagal"}`);
      }
    }
  }
  const message = `${imported} transaksi berhasil diimpor${duplicates ? `, ${duplicates} duplikat dilewati` : ""}${errors.length ? `, ${errors.length} gagal` : ""}.`;
  if (imported)
    await logActivity("import", "transactions", { imported, duplicates, failed: errors.length });
  return { imported, duplicates, failed: errors.length, errors: errors.slice(0, 10), message };
}

/* ---------------- Reports ---------------- */
export async function categoryTrend(months: number, endMonth: string, scope?: Scope) {
  const first = shiftMonth(endMonth, -(months - 1));
  const { start } = monthRange(first);
  const { end } = monthRange(endMonth);
  const rows = await monthCategoryTotals(
    start,
    end,
    () => fetchAggTx(start, end, { kind: "expense", hardCap: 50000, scope }),
    scope,
  );
  const list = Array.from({ length: months }, (_, i) => shiftMonth(first, i));
  return { months: list, ...categoryTrendSeries(list, rows) };
}

export async function yearlySummary(year: number, scope?: Scope) {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const totals = await monthTotals(
    start,
    end,
    () => fetchAggTx(start, end, { hardCap: 100000, scope }),
    scope,
  );
  const months = monthSeries(
    Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`),
    totals,
  ).map((m) => ({ ...m, net: m.income - m.expense }));
  const income = months.reduce((a, m) => a + m.income, 0);
  const expense = months.reduce((a, m) => a + m.expense, 0);
  const t = today();
  const activeMonths =
    Number(t.slice(0, 4)) === year ? Number(t.slice(5, 7)) : Number(t.slice(0, 4)) > year ? 12 : 0;
  const div = Math.max(1, activeMonths);
  return {
    year,
    income,
    expense,
    net: income - expense,
    avgIncome: income / div,
    avgExpense: expense / div,
    months,
  };
}

/* ---------------- CSV import ---------------- */
export async function importTransactions(
  rows: import("./schemas").ImportRowInput[],
  createMissing: boolean,
) {
  const cats = must(await db().from("categories").select("id, name, kind"));
  const accs = must(await db().from("accounts").select("id, name"));
  const catMap = new Map(
    cats.map((c) => [`${c.kind}:${String(c.name).toLowerCase()}`, c.id as string]),
  );
  const accMap = new Map(accs.map((a) => [String(a.name).toLowerCase(), a.id as string]));
  const rate = await getUsdIdr();
  const out: TxInsert[] = [];
  let createdCategories = 0;
  let createdAccounts = 0;
  let duplicates = 0;
  const dates = rows.map((r) => r.date);
  const existing = dates.length
    ? must<DupRow[]>(
        await fetchAll(
          (from, to) =>
            db()
              .from("transactions")
              .select("occurred_at, kind, amount, currency, description")
              .gte(
                "occurred_at",
                dates.reduce((a, b) => (a < b ? a : b)),
              )
              .lte(
                "occurred_at",
                dates.reduce((a, b) => (a > b ? a : b)),
              )
              .order("id")
              .range(from, to),
          { hardCap: 50000 },
        ),
      )
    : [];
  const seen = new Set(
    existing.map((t) =>
      dupKey({
        date: t.occurred_at,
        kind: t.kind,
        amount: Number(t.amount),
        currency: t.currency,
        description: t.description,
      }),
    ),
  );
  for (const r of rows) {
    const key = dupKey({
      date: r.date,
      kind: r.kind,
      amount: r.amount,
      currency: r.currency,
      description: r.notes,
    });
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    let category_id: string | null = null;
    if (r.category) {
      const key2 = `${r.kind}:${r.category.toLowerCase()}`;
      category_id = catMap.get(key2) ?? null;
      if (!category_id && createMissing) {
        category_id = must(
          await db()
            .from("categories")
            .insert({ name: r.category, kind: r.kind })
            .select("id")
            .single(),
        ).id;
        catMap.set(key2, category_id!);
        createdCategories++;
      }
    }
    let account_id: string | null = null;
    if (r.account) {
      const key2 = r.account.toLowerCase();
      account_id = accMap.get(key2) ?? null;
      if (!account_id && createMissing) {
        account_id = must(
          await db()
            .from("accounts")
            .insert({ name: r.account, type: "other", currency: r.currency })
            .select("id")
            .single(),
        ).id;
        accMap.set(key2, account_id!);
        createdAccounts++;
      }
    }
    out.push({
      kind: r.kind,
      amount: r.amount,
      currency: r.currency,
      amount_idr: await toIdr(r.amount, r.currency, rate),
      category_id,
      account_id,
      description: r.notes,
      occurred_at: r.date,
      source: "import",
    });
  }
  for (let i = 0; i < out.length; i += 500)
    must(
      await db()
        .from("transactions")
        .insert(out.slice(i, i + 500)),
    );
  if (out.length) await logActivity("import", "transactions", { imported: out.length, duplicates });
  return { inserted: out.length, duplicates, createdCategories, createdAccounts };
}

/* ---------------- Email ---------------- */
export async function reminderEmail(days: number) {
  const { buildReminderEmail } = await import("./email");
  const list = await computeReminders(days);
  return { count: list.length, reminders: list, ...buildReminderEmail(list) };
}

export async function sendReminderEmail(days: number, to?: string) {
  if ((await import("./demo.server")).isDemo())
    return { sent: false, reason: "Tidak tersedia di mode demo" };
  const { getIntegrations } = await import("./integrations.server");
  const cfg = await getIntegrations(["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_TO"]);
  const key = cfg.RESEND_API_KEY;
  const from = cfg.EMAIL_FROM;
  const recipient = to || cfg.EMAIL_TO;
  if (!key || !from || !recipient)
    return {
      sent: false,
      reason: "Email langsung belum dikonfigurasi (RESEND_API_KEY, EMAIL_FROM, EMAIL_TO).",
    };
  const mail = await reminderEmail(days);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: recipient.split(",").map((s) => s.trim()),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    return {
      sent: false,
      reason: `Gagal mengirim email (status ${res.status}).`,
      count: mail.count,
    };
  }
  return { sent: true, count: mail.count, subject: mail.subject };
}

/* ---------------- Reports: net worth ---------------- */
/**
 * Member net worth (v18): the summed balance of the permitted wallets only (no gold, receivables
 * or other wallets). Transfers between two permitted wallets cancel out.
 */
async function walletNetWorthSeries(months: number, endMonth: string, scope: readonly string[]) {
  const { end } = monthRange(endMonth);
  const ids = scopeIds(scope);
  const [rate, accRes, txRes] = await Promise.all([
    getUsdIdr(),
    db().from("accounts").select("id, initial_balance, currency").in("id", ids),
    fetchAll<Pick<TxRow, "kind" | "amount" | "account_id" | "to_account_id" | "occurred_at">>(
      (from, to) =>
        db()
          .from("transactions")
          .select("kind, amount, account_id, to_account_id, occurred_at")
          .or(txScopeFilter(ids))
          .lt("occurred_at", end)
          .order("id")
          .range(from, to),
      { hardCap: 200000 },
    ),
  ]);
  const accs = must(accRes);
  const txs =
    must<Pick<TxRow, "kind" | "amount" | "account_id" | "to_account_id" | "occurred_at">[]>(txRes);
  const wallets = new Map(accs.map((a) => [a.id, { currency: a.currency }]));
  let cum = 0;
  for (const a of accs) cum += Number(a.initial_balance) * (a.currency === "USD" ? rate : 1);
  const nets = new Map(walletNetByMonth(txs, wallets, rate).map((n) => [n.month, n.net]));
  const first = shiftMonth(endMonth, -(months - 1));
  for (const [m, v] of [...nets.entries()].sort()) if (m < first) cum += v;
  const out: { month: string; netWorth: number; gold: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(endMonth, -i);
    cum += nets.get(m) ?? 0;
    out.push({ month: m, netWorth: r2(cum), gold: 0 });
  }
  return out;
}

export async function netWorthSeries(months = 12, endMonth: string, scope?: Scope) {
  if (scope) return walletNetWorthSeries(months, endMonth, scope);
  const { end } = monthRange(endMonth);
  const assets = await import("./assets.server");
  const rateP = getUsdIdr();
  const [rate, accRes, nets, goldRows, prices, recv] = await Promise.all([
    rateP,
    db().from("accounts").select("initial_balance, currency"),
    monthlyNetBefore(end, () => fetchAggTx(null, end, { hardCap: 200000 })),
    assets.goldGramsByMonth(),
    assets.getGoldPrices().catch(() => ({ world: null, antam: null })),
    rateP.then((r) => assets.receivableDeltasByMonth(r)),
  ]);
  const accs = must(accRes);
  let initial = 0;
  for (const a of accs) initial += Number(a.initial_balance) * (a.currency === "USD" ? rate : 1);
  const first = shiftMonth(endMonth, -(months - 1));
  const monthlyNet = new Map<string, number>();
  const add = (m: string, v: number) => monthlyNet.set(m, (monthlyNet.get(m) ?? 0) + v);
  for (const n of nets) add(n.month, n.net);
  for (const r of recv) add(r.month, r.delta);
  const gramsDelta = new Map<string, number>();
  for (const g of goldRows) gramsDelta.set(g.month, (gramsDelta.get(g.month) ?? 0) + g.grams);
  const goldPrice = prices.world?.buyback ?? prices.antam?.buyback ?? 0;
  let cum = initial;
  let grams = 0;
  for (const m of [...new Set([...monthlyNet.keys(), ...gramsDelta.keys()])].sort()) {
    if (m >= first) break;
    cum += monthlyNet.get(m) ?? 0;
    grams += gramsDelta.get(m) ?? 0;
  }
  const out: { month: string; netWorth: number; gold: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(endMonth, -i);
    cum += monthlyNet.get(m) ?? 0;
    grams += gramsDelta.get(m) ?? 0;
    const gold = r2(Math.max(0, grams) * goldPrice);
    out.push({ month: m, netWorth: r2(cum + gold), gold });
  }
  return out;
}

/* ---------------- Backup ---------------- */
export async function exportBackup() {
  const tables = [
    "accounts",
    "categories",
    "transactions",
    "debts",
    "debt_payments",
    "subscriptions",
    "budgets",
    "goals",
    "fx_rates",
    "gold_purchases",
    "gold_prices",
    "receivables",
    "receivable_payments",
    "recurring_transactions",
    "budget_alerts",
    "account_reconciliations",
    "app_settings",
    "app_users",
    "account_permissions",
  ] as const;
  const { stripSecrets } = await import("./backup");
  const data: Record<string, any[]> = {};
  // Tables keyed without an `id` column (fx_rates, gold_prices) use their composite primary key for stable paging.
  const orderKeys: Partial<Record<(typeof tables)[number], string[]>> = {
    fx_rates: ["rate_date", "base", "quote"],
    gold_prices: ["price_date", "source"],
    account_permissions: ["user_id", "account_id"],
  };
  const results = await Promise.all(
    tables.map((t) =>
      fetchAll(
        (from, to) => {
          let q: any = db().from(t).select("*");
          for (const k of orderKeys[t] ?? ["id"]) q = q.order(k);
          return q.range(from, to);
        },
        { hardCap: 50000 },
      ),
    ),
  );
  tables.forEach((t, i) => {
    const r = results[i]!;
    if (r.error && !isMissingTable(r.error)) throw new Error(r.error.message);
    // v17 app_users: profile fields only, never password_hash / session_version.
    data[t] = stripSecrets(t, (r.data ?? []) as any[]);
  });
  await logActivity("backup.export", null, { tables: tables.length });
  return { exportedAt: new Date().toISOString(), app: "dompetku", version: 1, data };
}

/* ---------------- Bot command (n8n) ---------------- */
function fmtMoney(n: number, c: string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: c,
    maximumFractionDigits: c === "USD" ? 2 : 0,
  }).format(n);
}

export async function botCommand(text: string): Promise<{ message: string; type: string }> {
  const { classifyBotCommand, botHelp, botSearchToken, clampMessage } = await import("./bot");
  const { reminderDays } = await import("./app-settings");
  const bot = await import("./bot.server");
  const cmd = classifyBotCommand(text);
  let message: string;
  switch (cmd.type) {
    case "balances":
      message = await bot.balancesText();
      break;
    case "summary":
      message = await bot.reportText(cmd.month ?? "month");
      break;
    case "report":
      message = await bot.reportText(cmd.period);
      break;
    case "list":
      message = await bot.listText(cmd.kind, cmd.period);
      break;
    case "debts":
      message = await bot.debtsText();
      break;
    case "subscriptions":
      message = await bot.subscriptionsText();
      break;
    case "budget":
      message = await bot.budgetText();
      break;
    case "receivables":
      message = await bot.receivablesText();
      break;
    case "undo": {
      const r = await bot.undoLast();
      message = r.message;
      break;
    }
    case "reminders":
      message = remindersText(
        await computeReminders(
          cmd.days ?? reminderDays(null, (await getAppSettings()).reminder_days, 14),
        ),
      );
      break;
    case "pay":
      message = await botPay(cmd.target, botSearchToken);
      break;
    case "withdraw":
      message = await cashWithdraw(cmd.amount, cmd.from, "telegram");
      break;
    case "help":
      message = botHelp();
      break;
    default:
      message = `🤖 Perintah tidak dikenali: "${text.slice(0, 50)}". Ketik /help untuk daftar perintah.`;
  }
  await logActivity("bot.command", null, { text: text.slice(0, 200), type: cmd.type });
  return { message: clampMessage(message), type: cmd.type };
}

async function botPay(target: string, clean: (s: string) => string): Promise<string> {
  if (!target) return "Sebutkan namanya juga, mis. 'sudah bayar Netflix' atau 'bayar cicilan KTA'.";
  const token = clean(target);
  const subs = must(
    await db()
      .from("subscriptions")
      .select("id, name")
      .ilike("name", `%${escapeLike(token)}%`)
      .limit(5),
  );
  const debts = must(
    await db()
      .from("debts")
      .select("id, name")
      .ilike("name", `%${escapeLike(token)}%`)
      .limit(5),
  );
  if (!subs.length && !debts.length)
    return `❓ Tidak menemukan langganan/cicilan bernama "${target}".`;
  if (subs.length + debts.length > 1)
    return `❓ Nama "${target}" cocok dengan beberapa item (${[...subs, ...debts].map((x) => x.name).join(", ")}). Sebutkan lebih spesifik.`;
  if (subs[0]) {
    const r = await paySubscription(subs[0]!.id, null, null);
    return `✅ Langganan ${subs[0]!.name} dicatat. Tagihan berikutnya ${r.next_due}.`;
  }
  const d = debts[0]!;
  const { count } = await db()
    .from("debt_payments")
    .select("id", { count: "exact", head: true })
    .eq("debt_id", d.id);
  await payDebt(d.id, null, null);
  return `✅ Cicilan ${d.name} ke-${(count ?? 0) + 1} dicatat.`;
}

/** ATM cash withdrawal = transfer from a bank/e-wallet account into the first cash account (created if missing). */
export async function cashWithdraw(
  amount: number,
  from: string | null,
  source: "web" | "telegram" = "web",
): Promise<string> {
  if (!(amount > 0)) return "Sebutkan nominalnya, mis. 'tarik tunai 500rb'.";
  let cash = await db()
    .from("accounts")
    .select("id, name")
    .eq("type", "cash")
    .eq("archived", false)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!cash.data)
    cash = await db()
      .from("accounts")
      .insert({ name: "Tunai", type: "cash", currency: "IDR", initial_balance: 0 })
      .select("id, name")
      .single();
  if (cash.error || !cash.data) throw new Error(cash.error?.message ?? "Akun tunai tidak tersedia");
  let fromId = from ? await findAccount(from) : null;
  if (!fromId) {
    const bank = await db()
      .from("accounts")
      .select("id")
      .eq("type", "bank")
      .eq("archived", false)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    fromId = (bank.data?.id as string) ?? null;
  }
  if (!fromId)
    return "❓ Tidak ada akun bank untuk ditarik. Sebutkan akunnya, mis. 'tarik tunai 500rb dari BCA'.";
  const fromName =
    (await db().from("accounts").select("name").eq("id", fromId).single()).data?.name ?? "-";
  await insertTransaction({
    kind: "transfer",
    amount,
    currency: "IDR",
    account_id: fromId,
    to_account_id: cash.data.id,
    category_id: null,
    description: "Tarik tunai",
    merchant: null,
    occurred_at: today(),
    source,
    items: null,
    notes: null,
    receipt_path: null,
  });
  return `🏧 Tarik tunai ${fmtMoney(amount, "IDR")} dari ${fromName} ke ${cash.data.name} dicatat.`;
}
