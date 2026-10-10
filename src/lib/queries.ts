import { queryOptions, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DEMO_CAP_REACHED, DEMO_DISABLED, DEMO_RATE_LIMITED } from "./demo";
import { translateNow } from "./i18n";
import {
  deleteRow,
  getBalances,
  getBudgets,
  getDashboard,
  getDebts,
  getFxRate,
  getNetWorth,
  getReminders,
  getTxCount,
  getYearly,
  getActivity,
  getCategoryTrend,
  getYearlySummary,
  getGold,
  getReceivables,
  getAssets,
  listRows,
  listTransactions,
  saveRow,
} from "./finance.functions";
import { getRecurring } from "./recurring.functions";
import { getAccountReport, getReconcileTransactions } from "./account-report.functions";
import { getProfile } from "./profile.functions";
import { getAccountPockets, getPocketOptions, getPocketWarnings } from "./pockets.functions";
import type { CrudTable } from "./schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
const FRESH = 60_000;
const REFERENCE_FRESH = 300_000;
export const rowsQuery = (table: CrudTable) =>
  queryOptions({
    queryKey: ["rows", table],
    queryFn: () => listRows({ data: { table } }),
    staleTime: REFERENCE_FRESH,
  });
/** Settings → Pengguna (v18, admin only). */
export const usersQueryKey = ["users"] as const;
/** Logged-in user's profile (v17); also feeds the header avatar. */
export const profileQuery = () =>
  queryOptions({ queryKey: ["profile"], queryFn: () => getProfile(), staleTime: 5 * 60_000 });
export const dashboardQuery = (month: string) =>
  queryOptions({
    queryKey: ["dashboard", month],
    queryFn: () => getDashboard({ data: { month } }),
    staleTime: FRESH,
  });
export const remindersQuery = (days: number) =>
  queryOptions({
    queryKey: ["reminders", days],
    queryFn: () => getReminders({ data: { days } }),
    staleTime: FRESH,
  });
export const debtsQuery = () =>
  queryOptions({ queryKey: ["debts"], queryFn: () => getDebts(), staleTime: FRESH });
export const budgetsQuery = (month: string) =>
  queryOptions({
    queryKey: ["budgets", month],
    queryFn: () => getBudgets({ data: { month } }),
    staleTime: FRESH,
  });
export const balancesQuery = () =>
  queryOptions({ queryKey: ["balances"], queryFn: () => getBalances(), staleTime: FRESH });
export const fxQuery = () =>
  queryOptions({ queryKey: ["fx"], queryFn: () => getFxRate(), staleTime: 3600_000 });
export type GoldFilter = {
  offset?: number;
  limit?: number;
  sort?: "occurred_at" | "grams" | "price_per_gram" | "total";
  direction?: "asc" | "desc";
};
export const goldQuery = (f: GoldFilter = {}) =>
  queryOptions({
    queryKey: ["gold", f],
    queryFn: () =>
      getGold({
        data: {
          offset: f.offset ?? 0,
          limit: f.limit ?? 25,
          sort: f.sort ?? "occurred_at",
          direction: f.direction ?? "desc",
        },
      }),
    staleTime: 300_000,
  });
export const assetsQuery = () =>
  queryOptions({ queryKey: ["assets"], queryFn: () => getAssets(), staleTime: FRESH });
export const receivablesQuery = (offset = 0, limit = 24) =>
  queryOptions({
    queryKey: ["receivables", offset, limit],
    queryFn: () => getReceivables({ data: { offset, limit } }),
  });
/** `account` = Laporan/Rekap wallet filter (#62); omitted = all wallets (same key and request as before). */
const withAccount = (account?: string) => (account ? { account } : {});
export const trendQuery = (months: number, end: string, account?: string) =>
  queryOptions({
    queryKey: account ? ["trend", months, end, account] : ["trend", months, end],
    queryFn: () => getCategoryTrend({ data: { months, end, ...withAccount(account) } }),
    staleTime: FRESH,
  });
export const yearlySummaryQuery = (year: number, account?: string) =>
  queryOptions({
    queryKey: account ? ["yearly-summary", year, account] : ["yearly-summary", year],
    queryFn: () => getYearlySummary({ data: { year, ...withAccount(account) } }),
    staleTime: FRESH,
  });
export const netWorthQuery = (months: number, end: string) =>
  queryOptions({
    queryKey: ["net-worth", months, end],
    queryFn: () => getNetWorth({ data: { months, end } }),
    staleTime: FRESH,
  });
export const recurringQuery = () =>
  queryOptions({ queryKey: ["recurring"], queryFn: () => getRecurring(), staleTime: FRESH });
export const activityQuery = (limit: number) =>
  queryOptions({
    queryKey: ["activity", limit],
    queryFn: () => getActivity({ data: { limit } }),
    staleTime: 30_000,
    retry: false,
  });
export type TxFilter = {
  month?: string;
  kind?: "income" | "expense" | "transfer";
  search?: string;
  category_id?: string;
  account_id?: string;
  pocket_id?: string;
  offset?: number;
  sort?: "occurred_at" | "amount" | "description";
  direction?: "asc" | "desc";
};
export const txQuery = (f: TxFilter) =>
  queryOptions({ queryKey: ["tx", f], queryFn: () => listTransactions({ data: f }) });
export const txCountQuery = (f: Omit<TxFilter, "offset">) =>
  queryOptions({ queryKey: ["tx-count", f], queryFn: () => getTxCount({ data: f }) });
export const accountReportQuery = (id: string, month: string) =>
  queryOptions({
    queryKey: ["account-report", id, month],
    queryFn: () => getAccountReport({ data: { id, month } }),
    staleTime: FRESH,
  });
/** v19 Kantong: wallet page card, form/list options and the dashboard warnings widget. */
export const accountPocketsQuery = (id: string, month: string) =>
  queryOptions({
    queryKey: ["pockets", "account", id, month],
    queryFn: () => getAccountPockets({ data: { id, month } }),
    staleTime: FRESH,
  });
export const pocketOptionsQuery = () =>
  queryOptions({
    queryKey: ["pockets", "options"],
    queryFn: () => getPocketOptions(),
    staleTime: REFERENCE_FRESH,
  });
export const pocketWarningsQuery = (month: string) =>
  queryOptions({
    queryKey: ["pockets", "warnings", month],
    queryFn: () => getPocketWarnings({ data: { month } }),
    staleTime: FRESH,
  });
export const reconcileTxQuery = (id: string, from: string, to: string) =>
  queryOptions({
    queryKey: ["account-recon", id, from, to],
    queryFn: () => getReconcileTransactions({ data: { id, from, to } }),
  });
export const yearlyQuery = (year: string, account?: string) =>
  queryOptions({
    queryKey: account ? ["yearly", year, account] : ["yearly", year],
    queryFn: () => getYearly({ data: { year, ...withAccount(account) } }),
    staleTime: FRESH,
  });

/** Money-moving changes touch every aggregate; reference data only touches its own lists. */
const MONEY = [
  "tx",
  "tx-count",
  "dashboard",
  "balances",
  "budgets",
  "trend",
  "yearly",
  "yearly-summary",
  "net-worth",
  "reminders",
  "activity",
  "assets",
  "account-report",
  "account-recon",
  "pockets",
];
const AFFECTS: Record<string, string[]> = {
  transactions: MONEY,
  accounts: [...MONEY, "rows"],
  categories: ["rows", "tx", "dashboard", "budgets", "trend", "activity"],
  debts: ["rows", "debts", "reminders", "dashboard", "activity"],
  debt_payments: [...MONEY, "debts"],
  subscriptions: ["rows", "reminders", "dashboard", "activity"],
  budgets: ["rows", "budgets", "dashboard", "activity"],
  goals: ["rows", "dashboard", "activity", "assets"],
  gold_purchases: [...MONEY, "rows", "gold"],
  receivables: [...MONEY, "receivables"],
  // Posting a recurring item creates transactions, so it touches every money aggregate.
  recurring_transactions: [...MONEY, "rows", "recurring"],
  account_reconciliations: ["account-report", "activity"],
  // v14 settings: branding (logo/name), the settings card itself, and "today"-based views.
  app_settings: ["branding", "app-settings", "activity", "dashboard", "reminders"],
  // v17 profile: the profile page, the header avatar and the activity log.
  // v18: user management list (Settings → Pengguna) too.
  app_users: ["profile", "activity", "users"],
  // v19 Kantong: pocket cards/options/warnings, transactions (badges/filter) and the activity log.
  pockets: ["pockets", "tx", "activity"],
};

export function invalidateFor(qc: QueryClient, table: string) {
  const keys = new Set(AFFECTS[table] ?? MONEY);
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      if (k === "rows")
        return (
          keys.has("rows") &&
          (q.queryKey[1] === table || table === "accounts" || table === "categories")
        );
      return typeof k === "string" && keys.has(k);
    },
  });
}

export function useCrud(table: CrudTable) {
  const qc = useQueryClient();
  const save = useServerFn(saveRow);
  const del = useServerFn(deleteRow);
  return {
    save: async (values: Record<string, unknown>, id?: string | null) => {
      await save({ data: { table, id: id ?? null, values } });
      await invalidateFor(qc, table);
    },
    remove: async (id: string) => {
      await del({ data: { table, id } });
      await invalidateFor(qc, table);
    },
  };
}

const DEMO_ERRORS = [DEMO_DISABLED, DEMO_CAP_REACHED, DEMO_RATE_LIMITED] as const;

export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Demo-mode guard errors are plain dictionary keys: show them in the active language.
  if ((DEMO_ERRORS as readonly string[]).includes(m)) return translateNow(m);
  try {
    const parsed = JSON.parse(m) as any[];
    if (Array.isArray(parsed))
      return parsed.map((x) => `${(x.path ?? []).join(".")}: ${x.message}`).join(", ");
  } catch {
    /* not json */
  }
  return m;
}
