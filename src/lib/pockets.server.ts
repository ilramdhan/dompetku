/**
 * v19 "Kantong" (envelope) server logic: pocket CRUD, per-month status, wallet "unallocated"
 * figure and threshold alerts deduplicated via `pocket_alerts`. Pure math lives in ./pockets.ts.
 * Every read degrades gracefully before schema v19 (`{ ready: false }` / empty lists), and the
 * alert check never throws, so saving a transaction is never affected.
 */
import { db } from "./db.server";
import { fetchAll } from "./paginate";
import { logError } from "./monitoring.server";
import { scopeIds } from "./permissions";
import {
  alertPeriod,
  crossedPocketLevels,
  matchPocket,
  pocketDelta,
  pocketRange,
  pocketsText,
  pocketStatus,
  unallocated,
  type Pocket,
  type PocketAlert,
  type PocketStatus,
  type PocketTx,
} from "./pockets";
import type { PocketInput } from "./schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Scope = readonly string[] | null | undefined;
export type PocketWithStatus = Pocket & PocketStatus;

const fin = () => import("./finance.server");
/** v19 not run: the pockets table or the transactions.pocket_id column is missing. */
const missing = async (err: { message?: string; code?: string } | null | undefined) =>
  (await fin()).isMissingTable(err) || /pocket_id/.test(err?.message ?? "");

/** Pockets of the given wallets (all when `accountIds` is null); null when v19 is not run. */
async function loadPockets(
  accountIds: readonly string[] | null,
  includeArchived = true,
): Promise<Pocket[] | null> {
  let q: any = db().from("pockets").select("*");
  if (accountIds) q = q.in("account_id", scopeIds(accountIds));
  if (!includeArchived) q = q.eq("archived", false);
  const res = await q.order("sort_order").order("name");
  if (res.error) {
    if (await missing(res.error)) return null;
    throw new Error(res.error.message);
  }
  return (res.data ?? []) as Pocket[];
}

/** Pocket transactions for `month` (monthly pockets) plus all-time rows of running envelopes. */
async function pocketTxs(pockets: readonly Pocket[], month: string): Promise<PocketTx[]> {
  if (!pockets.length) return [];
  const monthly = pockets.filter((p) => pocketRange(p, month)).map((p) => p.id);
  const running = pockets.filter((p) => !pocketRange(p, month)).map((p) => p.id);
  const range = pocketRange({ period: "monthly" }, month)!;
  const sel = "id, kind, amount, account_id, pocket_id, occurred_at";
  const out: PocketTx[] = [];
  for (const [ids, ranged] of [
    [monthly, true],
    [running, false],
  ] as const) {
    if (!ids.length) continue;
    const res = await fetchAll<PocketTx>(
      (from, to) => {
        let q: any = db().from("transactions").select(sel).in("pocket_id", scopeIds(ids));
        if (ranged) q = q.gte("occurred_at", range.start).lt("occurred_at", range.end);
        return q.order("id").range(from, to);
      },
      { hardCap: 50_000 },
    );
    if (res.error) {
      if (await missing(res.error)) return [];
      throw new Error(res.error.message);
    }
    out.push(...(res.data ?? []));
  }
  return out;
}

export async function pocketsWithStatus(
  pockets: readonly Pocket[],
  month: string,
): Promise<PocketWithStatus[]> {
  const txs = await pocketTxs(pockets, month);
  return pockets.map((p) => ({ ...p, ...pocketStatus(p, txs, month) }));
}

/** Wallet page: pockets with status, the wallet balance and the unallocated amount. */
export async function accountPockets(accountId: string, month: string) {
  const list = await loadPockets([accountId]);
  if (!list) return { ready: false as const, pockets: [], balance: 0, unallocated: null };
  const bal = await db()
    .from("account_balances")
    .select("balance")
    .eq("id", accountId)
    .maybeSingle();
  const balance = Number(bal.data?.balance) || 0;
  const pockets = await pocketsWithStatus(list, month);
  return {
    ready: true as const,
    pockets,
    balance,
    unallocated: unallocated(balance, pockets),
  };
}

/** Active pockets in the caller's wallets, for the transaction form/list (names only). */
export async function pocketOptions(scope: Scope) {
  const list = await loadPockets(scope ? [...scope] : null);
  return (list ?? []).map((p) => ({
    id: p.id,
    account_id: p.account_id,
    name: p.name,
    archived: !!p.archived,
    sort_order: p.sort_order ?? 0,
    color: p.color ?? null,
  }));
}

/** Dashboard: active pockets at/below their threshold this month (members: visible wallets). */
export async function pocketWarnings(scope: Scope, month: string) {
  try {
    const list = await loadPockets(scope ? [...scope] : null, false);
    if (!list?.length) return [];
    const names = await accountNames(list.map((p) => p.account_id));
    return (await pocketsWithStatus(list, month))
      .filter((p) => p.level)
      .map((p) => ({
        ...p,
        account: names.get(p.account_id)?.name ?? null,
        currency: names.get(p.account_id)?.currency ?? "IDR",
      }))
      .sort((a, b) => a.percentLeft - b.percentLeft);
  } catch (e) {
    logError("pockets.warnings", e);
    return [];
  }
}

async function accountNames(ids: readonly string[]) {
  const res = await db()
    .from("accounts")
    .select("id, name, currency")
    .in("id", scopeIds([...new Set(ids)]));
  return new Map((res.data ?? []).map((a) => [a.id, a]));
}

export async function loadPocket(id: string): Promise<Pocket | null> {
  const res = await db().from("pockets").select("*").eq("id", id).maybeSingle();
  if (res.error) {
    if (await missing(res.error)) return null;
    throw new Error(res.error.message);
  }
  return (res.data as Pocket | null) ?? null;
}

const V19_MISSING = "Fitur kantong belum aktif: jalankan bagian v19 di supabase/schema.sql.";

/** Create/update. The wallet of an existing pocket never changes (its history belongs to it). */
export async function savePocket(id: string | null, v: PocketInput, accountId: string) {
  const row = {
    name: v.name,
    allocated: v.allocated,
    min_balance: v.min_balance,
    period: v.period,
    icon: v.icon,
    color: v.color,
    archived: v.archived,
    sort_order: v.sort_order,
  };
  const res = id
    ? await db()
        .from("pockets")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single()
    : await db()
        .from("pockets")
        .insert({ ...row, account_id: accountId })
        .select()
        .single();
  if (res.error) {
    if (/duplicate key|23505/i.test(`${res.error.message} ${res.error.code ?? ""}`))
      throw new Error("Nama kantong sudah dipakai di dompet ini");
    if (await missing(res.error)) throw new Error(V19_MISSING);
    throw new Error(res.error.message);
  }
  await (
    await fin()
  ).logActivity(`pockets.${id ? "update" : "create"}`, "pockets", {
    name: v.name,
    amount: v.allocated,
    currency: null,
  });
  return res.data as Pocket;
}

/** Deletes a pocket; its transactions keep existing with pocket_id = null (FK on delete set null). */
export async function deletePocket(p: Pocket) {
  const res = await db().from("pockets").delete().eq("id", p.id);
  if (res.error) throw new Error(res.error.message);
  await (await fin()).logActivity("pockets.delete", "pockets", { name: p.name });
  return { ok: true };
}

/**
 * Throws unless `pocketId` may be stored on a transaction with these sides: the pocket must exist,
 * be active (or already be on the edited row) and belong to the transaction's source wallet.
 * Members therefore need manage on the pocket's wallet (checked by assertTxWrite on account_id).
 */
export async function assertPocketForTx(
  pocketId: string | null | undefined,
  tx: { kind?: string | null; account_id?: string | null },
  prevPocketId?: string | null,
): Promise<void> {
  if (!pocketId) return;
  const p = await loadPocket(pocketId);
  if (!p || p.account_id !== tx.account_id) throw new Error("Kantong tidak cocok dengan dompet");
  if (p.archived && p.id !== prevPocketId) throw new Error("Kantong sudah diarsipkan");
}

/** Pocket id for a bot/n8n tag in the given wallet (null when not found or v19 not run). */
export async function findPocketId(
  accountId: string | null | undefined,
  tag: string | null | undefined,
): Promise<string | null> {
  if (!accountId || !tag) return null;
  try {
    return matchPocket((await loadPockets([accountId], false)) ?? [], tag)?.id ?? null;
  } catch {
    return null;
  }
}

/** Records a crossing; false when already alerted this month. Missing table → true (no dedupe). */
async function claimAlert(pocketId: string, period: string, level: string): Promise<boolean> {
  const res = await db().from("pocket_alerts").insert({ pocket_id: pocketId, period, level });
  if (!res.error) return true;
  if (/duplicate key|23505/i.test(`${res.error.message} ${res.error.code ?? ""}`)) return false;
  if ((await fin()).isMissingTable(res.error)) return true;
  throw new Error(res.error.message);
}

type TxLike = PocketTx & { id?: string };

/**
 * Pocket threshold crossings caused by a just-saved transaction (`prev` = the row before an
 * edit). Only crossings in the current month (app time zone) on the way down alert. Never throws.
 */
export async function pocketAlertsFor(
  tx: TxLike | null | undefined,
  prev?: TxLike | null,
): Promise<PocketAlert[]> {
  try {
    if (!tx?.pocket_id) return [];
    const f = await fin();
    const month = f.today().slice(0, 7);
    const p = await loadPocket(tx.pocket_id);
    if (!p || p.archived) return [];
    const inPeriod = (row: TxLike | null | undefined) => {
      if (!row || row.pocket_id !== p.id) return false;
      const r = pocketRange(p, month);
      const day = String(row.occurred_at).slice(0, 10);
      return !r || (day >= r.start && day < r.end);
    };
    if (!inPeriod(tx)) return [];
    const [s] = await pocketsWithStatus([p], month);
    if (!s) return [];
    // Remaining before this save: undo the new row, redo the previous version of it.
    const before =
      s.remaining -
      pocketDelta(tx, p.account_id) +
      (inPeriod(prev) ? pocketDelta(prev!, p.account_id) : 0);
    const { report, claim } = crossedPocketLevels(before, s.remaining, p.min_balance);
    if (!claim.length) return [];
    const claimed = new Set<string>();
    for (const level of claim)
      if (await claimAlert(p.id, alertPeriod(month), level)) claimed.add(level);
    const acc = (await accountNames([p.account_id])).get(p.account_id);
    return report
      .filter((l) => claimed.has(l))
      .map((level) => ({
        pocket_id: p.id,
        pocket: p.name,
        account: acc?.name ?? null,
        currency: acc?.currency ?? "IDR",
        level,
        remaining: s.remaining,
        allocated: s.allocated,
        min_balance: p.min_balance == null ? null : Number(p.min_balance),
      }));
  } catch (e) {
    logError("pockets.alerts", e);
    return [];
  }
}

/** Telegram `/kantong`: every wallet's pockets this month (owner only — the bot is admin). */
export async function pocketsBotText(): Promise<string> {
  const f = await fin();
  const month = f.today().slice(0, 7);
  const list = await loadPockets(null, false);
  if (!list) return "Fitur kantong belum aktif (jalankan skema v19).";
  const withStatus = await pocketsWithStatus(list, month);
  const bal = await db()
    .from("account_balances")
    .select("id, name, currency, balance")
    .in("id", scopeIds([...new Set(list.map((p) => p.account_id))]))
    .order("name");
  const wallets = (bal.data ?? []).map((a: any) => ({
    name: String(a.name),
    currency: String(a.currency ?? "IDR"),
    balance: Number(a.balance) || 0,
    pockets: withStatus.filter((p) => p.account_id === a.id),
  }));
  return pocketsText(wallets, month);
}
