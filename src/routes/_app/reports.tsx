import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { SortButton, type SortDirection } from "@/components/sort-button";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { CategoryLineChart } from "@/components/charts";
import { CHART_PALETTE as FALLBACK } from "@/components/charts/shared";
import { PENDING_MS, ReportsSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/segmented";
import { rowsQuery, trendQuery, yearlySummaryQuery } from "@/lib/queries";
import { WalletFilter } from "@/components/wallet-filter";
import {
  isTransferCategory,
  resolveReportAccount,
  validateReportSearch,
} from "@/lib/report-filter";
import { currentMonth, monthLabel, shortMonth } from "@/lib/dates";
import { compact, money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";

export const Route = createFileRoute("/_app/reports")({
  head: () => pageHead("Laporan", "Tren pengeluaran per kategori dan rekap tahunan."),
  validateSearch: validateReportSearch,
  loaderDeps: ({ search }) => ({ account: search.account }),
  loader: async ({ context, deps }) => {
    const qc = context.queryClient;
    // Unknown / not-visible wallet ids fall back to all wallets (the list is server-scoped).
    const account = deps.account
      ? resolveReportAccount(deps.account, await qc.ensureQueryData(rowsQuery("accounts")))
      : undefined;
    return Promise.all([
      qc.ensureQueryData(trendQuery(6, currentMonth(), account)),
      qc.ensureQueryData(yearlySummaryQuery(Number(currentMonth().slice(0, 4)), account)),
    ]);
  },
  errorComponent: RouteError,
  pendingComponent: ReportsSkeleton,
  pendingMs: PENDING_MS,
  component: ReportsPage,
});

/** Wallet filter state from `?account=` (validated, and dropped when not a visible wallet). */
function useReportAccount() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as { id: string; name: string }[];
  const account = resolveReportAccount(search.account, accounts);
  const setAccount = (a: string | undefined) =>
    void navigate({ search: a ? { account: a } : {}, replace: true });
  return { account, accounts, setAccount };
}

function ReportsPage() {
  const { t } = useI18n();
  const { account, accounts, setAccount } = useReportAccount();
  return (
    <>
      <PageHeader
        title={t("Laporan")}
        subtitle={t("Lihat ke mana uang Anda pergi dari bulan ke bulan dan sepanjang tahun.")}
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            {t("Cetak PDF")}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <WalletFilter value={account} accounts={accounts} onChange={setAccount} />
        {account ? (
          <p className="text-xs text-muted-foreground">
            {t("Transfer dihitung sebagai uang masuk/keluar dompet ini.")}
          </p>
        ) : null}
      </div>
      <CategoryTrend account={account} />
      <YearlyRecap account={account} />
    </>
  );
}

function CategoryTrend({ account }: { account: string | undefined }) {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [months, setMonths] = useState(6);
  const { data } = useQuery({
    ...trendQuery(months, currentMonth(), account),
    placeholderData: (p) => p,
  });
  const [selected, setSelected] = useState<string[] | null>(null);
  // Wallet filter: pick the default top 5 again for the new wallet's categories.
  const [prevAccount, setPrevAccount] = useState(account);
  if (prevAccount !== account) {
    setPrevAccount(account);
    setSelected(null);
  }
  const cats = useMemo(
    () =>
      (data?.categories ?? []).map((c) =>
        isTransferCategory(c.name) ? { ...c, name: t(c.name) } : c,
      ),
    [data, t],
  );
  useEffect(() => {
    if (selected === null && cats.length) setSelected(cats.slice(0, 5).map((c) => c.id));
  }, [cats, selected]);
  const sel = selected ?? [];
  const chart = useMemo(
    () =>
      (data?.series ?? []).map((r) => ({ ...r, label: shortMonth(String(r["month"]), locale) })),
    [data, locale],
  );

  const toggle = (id: string) =>
    setSelected((s) =>
      (s ?? []).includes(id) ? (s ?? []).filter((x) => x !== id) : [...(s ?? []), id],
    );

  return (
    <Card className="min-w-0 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("Tren pengeluaran per kategori")}</h2>
        <Segmented
          label={t("Rentang waktu")}
          value={String(months)}
          onValueChange={(v) => setMonths(Number(v))}
          options={[
            { value: "6", label: `6 ${t("bulan")}` },
            { value: "12", label: `12 ${t("bulan")}` },
          ]}
        />
      </div>
      {cats.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("Belum ada pengeluaran pada periode ini.")}
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {cats.map((c, i) => {
              const on = sel.includes(c.id);
              return (
                <Button
                  key={c.id}
                  size="sm"
                  variant={on ? "secondary" : "outline"}
                  aria-pressed={on}
                  onClick={() => toggle(c.id)}
                  className="h-8 max-w-full rounded-full px-3 text-xs"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: c.color ?? FALLBACK[i % FALLBACK.length] }}
                  />
                  <span className="truncate">{c.name}</span>{" "}
                  <span className="num opacity-70">{compact(c.total)}</span>
                </Button>
              );
            })}
          </div>
          <div className="h-64 sm:h-80 short:h-56">
            <CategoryLineChart
              data={chart}
              series={cats.flatMap((c, i) =>
                sel.includes(c.id)
                  ? [{ key: c.id, name: c.name, color: c.color ?? FALLBACK[i % FALLBACK.length]! }]
                  : [],
              )}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function YearlyRecap({ account }: { account: string | undefined }) {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const [sort, setSort] = useState<"month" | "income" | "expense" | "net">("month");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const { data: y, isFetching } = useQuery({
    ...yearlySummaryQuery(year, account),
    placeholderData: (p) => p,
  });
  const sortedMonths = useMemo(
    () =>
      [...(y?.months ?? [])].sort((a, b) => {
        const av = a[sort];
        const bv = b[sort];
        return (
          (typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv)) *
          (direction === "asc" ? 1 : -1)
        );
      }),
    [y, sort, direction],
  );
  const sortBy = (column: typeof sort) => {
    setDirection((d) => (sort === column ? (d === "asc" ? "desc" : "asc") : "asc"));
    setSort(column);
  };

  function exportCsv() {
    if (!y) return;
    const lines = [
      [t("Bulan"), t("Pemasukan"), t("Pengeluaran"), t("Selisih")],
      ...y.months.map((m) => [m.month, m.income, m.expense, m.net]),
      [t("Total"), y.income, y.expense, y.net],
    ];
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + lines.map((l) => l.join(",")).join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `rekap-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("Rekap tahunan")}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setYear(year - 1)}
            aria-label={t("Tahun sebelumnya")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="num min-w-16 text-center font-semibold">{year}</span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setYear(year + 1)}
            aria-label={t("Tahun berikutnya")}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button size="sm" variant="outline" className="no-print ml-2" onClick={exportCsv}>
            <Download className="size-4" /> CSV
          </Button>
          {isFetching ? (
            <span className="ml-2 text-xs text-muted-foreground">{t("Memuat…")}</span>
          ) : null}
        </div>
      </div>
      {y ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t("Total pemasukan")} value={y.income} className="text-income" />
            <Stat label={t("Total pengeluaran")} value={y.expense} className="text-expense" />
            <Stat
              label={t("Selisih")}
              value={y.net}
              className={y.net >= 0 ? "text-income" : "text-expense"}
            />
            <div className="min-w-0 rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">{t("Rata-rata bulanan")}</p>
              <p className="num mt-1 break-words text-sm font-semibold text-income">
                +{money(y.avgIncome)}
              </p>
              <p className="num break-words text-sm font-semibold text-expense">
                −{money(y.avgExpense)}
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Bulan")}
                      active={sort === "month"}
                      direction={direction}
                      onClick={() => sortBy("month")}
                    />
                  </th>
                  <th className="px-3 py-1 text-right">
                    <SortButton
                      label={t("Pemasukan")}
                      active={sort === "income"}
                      direction={direction}
                      onClick={() => sortBy("income")}
                    />
                  </th>
                  <th className="px-3 py-1 text-right">
                    <SortButton
                      label={t("Pengeluaran")}
                      active={sort === "expense"}
                      direction={direction}
                      onClick={() => sortBy("expense")}
                    />
                  </th>
                  <th className="px-3 py-1 text-right">
                    <SortButton
                      label={t("Selisih")}
                      active={sort === "net"}
                      direction={direction}
                      onClick={() => sortBy("net")}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedMonths.map((m) => (
                  <tr key={m.month}>
                    <td className="whitespace-nowrap px-3 py-2 capitalize">
                      {monthLabel(m.month, locale)}
                    </td>
                    <td className="num px-3 py-2 text-right text-income">{money(m.income)}</td>
                    <td className="num px-3 py-2 text-right text-expense">{money(m.expense)}</td>
                    <td
                      className={`num px-3 py-2 text-right font-semibold ${m.net >= 0 ? "" : "text-expense"}`}
                    >
                      {money(m.net)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/60 font-semibold">
                  <td className="px-3 py-2">{t("Total")}</td>

                  <td className="num px-3 py-2 text-right text-income">{money(y.income)}</td>
                  <td className="num px-3 py-2 text-right text-expense">{money(y.expense)}</td>
                  <td className="num px-3 py-2 text-right">{money(y.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  usePrivacy();
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-1 break-words text-xl font-semibold ${className ?? ""}`}>
        {money(value)}
      </p>
    </div>
  );
}
