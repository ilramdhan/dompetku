/**
 * Pure, client-safe helpers for the wallet filter on Laporan and Rekap tahunan (issue #62).
 *
 * - `?account=<uuid>` is the only search param; anything invalid is dropped (= all wallets).
 * - The client further drops ids that are not in its (server-scoped) account list.
 * - The server intersects the requested id with the caller's `accountScope()`; an id outside a
 *   member's scope matches nothing (empty report, no data leak, no existence probe).
 * - With one wallet selected, transfers count as money in/out of that wallet, exactly like the
 *   per-account report (`flowOf` in account-report.ts / `dk_account_monthly`): they become
 *   pseudo-category rows ("Transfer masuk" / "Transfer keluar") so the existing JS aggregators
 *   (aggregate.ts) can be reused unchanged.
 */
import { TRANSFER_OUT } from "./account-report";

export { TRANSFER_OUT };
export const TRANSFER_IN = "Transfer masuk";
/** Pseudo category ids of transfer rows in wallet-filtered reports. */
export const TRANSFER_OUT_ID = "transfer-out";
export const TRANSFER_IN_ID = "transfer-in";
/** Matches nothing: used when a member asks for a wallet outside their scope. */
export const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A wallet id from the URL (lower-cased uuid) or undefined. */
export function parseAccountParam(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return UUID.test(s) && s !== NO_ACCOUNT ? s : undefined;
}

export type ReportSearch = { account?: string };

/** Route `validateSearch` for /reports and /rekap: keeps only a valid `account`. */
export function validateReportSearch(search: Record<string, unknown>): ReportSearch {
  const account = parseAccountParam(search["account"]);
  return account ? { account } : {};
}

/** The wallet the page should show: the URL id only if it is one of the visible accounts. */
export function resolveReportAccount(
  account: string | undefined,
  accounts: readonly { id: string }[] | null | undefined,
): string | undefined {
  if (!account) return undefined;
  return (accounts ?? []).some((a) => String(a.id).toLowerCase() === account) ? account : undefined;
}

/**
 * Server-side intersection of the requested wallet with the caller's scope (null = owner, all).
 * - no wallet requested → `{ scope, account: null }` (today's behaviour, unchanged);
 * - owner → that wallet;
 * - member asking for a permitted wallet → that wallet;
 * - member asking for anything else → `NO_ACCOUNT` (an empty report).
 */
export function reportScope(
  scope: readonly string[] | null | undefined,
  requested: unknown,
): { scope: readonly string[] | null | undefined; account: string | null } {
  if (requested === undefined || requested === null || requested === "")
    return { scope, account: null };
  const id = parseAccountParam(requested);
  if (!id) return { scope, account: NO_ACCOUNT };
  if (!scope) return { scope, account: id };
  return {
    scope,
    account: scope.some((s) => String(s).toLowerCase() === id) ? id : NO_ACCOUNT,
  };
}

type CatRef = { name?: string | null; color?: string | null } | null | undefined;
export type WalletTx = {
  kind: string;
  amount_idr: unknown;
  occurred_at: unknown;
  category_id?: string | null;
  category?: CatRef;
  account_id?: string | null;
  to_account_id?: string | null;
};
export type WalletAggRow = {
  kind: "income" | "expense";
  amount_idr: number;
  occurred_at: unknown;
  category_id: string | null;
  category: CatRef;
};

/**
 * Transactions → income/expense rows from one wallet's point of view (same CASE as
 * `account_balances` / `flowOf`): income/expense recorded on the wallet keep their category;
 * a transfer from it is an expense "Transfer keluar"; a transfer to it is an income
 * "Transfer masuk". A row with account_id = to_account_id counts only as outflow. Rows that do
 * not touch the wallet are dropped. Amounts are in IDR (`amount_idr`) like every report total.
 */
export function walletAggRows(rows: readonly WalletTx[], accountId: string): WalletAggRow[] {
  const out: WalletAggRow[] = [];
  for (const t of rows) {
    const v = Number(t.amount_idr) || 0;
    const base = { amount_idr: v, occurred_at: t.occurred_at };
    if (t.account_id === accountId) {
      if (t.kind === "income" || t.kind === "expense")
        out.push({
          ...base,
          kind: t.kind,
          category_id: t.category_id ?? null,
          category: t.category ?? null,
        });
      else if (t.kind === "transfer")
        out.push({
          ...base,
          kind: "expense",
          category_id: TRANSFER_OUT_ID,
          category: { name: TRANSFER_OUT, color: null },
        });
    } else if (t.to_account_id === accountId && t.kind === "transfer") {
      out.push({
        ...base,
        kind: "income",
        category_id: TRANSFER_IN_ID,
        category: { name: TRANSFER_IN, color: null },
      });
    }
  }
  return out;
}

/** True for the pseudo transfer category names (the UI translates these). */
export function isTransferCategory(name: string | null | undefined): boolean {
  return name === TRANSFER_OUT || name === TRANSFER_IN;
}
