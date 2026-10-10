import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { CashflowBarChart, DonutChart } from "@/components/charts";
import { CHART_PALETTE as PIE } from "@/components/charts/shared";
import { PENDING_MS, RekapSkeleton } from "@/components/skeletons";
import { Empty } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { rowsQuery, yearlyQuery } from "@/lib/queries";
import { WalletFilter } from "@/components/wallet-filter";
import {
  isTransferCategory,
  resolveReportAccount,
  validateReportSearch,
} from "@/lib/report-filter";
import { currentMonth, shortMonth } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const Route = createFileRoute("/_app/rekap")({
  head: () =>
    pageHead(
      "Rekap Tahunan",
      "Total pemasukan, pengeluaran, dan rata-rata bulanan sepanjang tahun.",
    ),
  validateSearch: validateReportSearch,
  loaderDeps: ({ search }) => ({ account: search.account }),
  loader: async ({ context, deps }) => {
    const qc = context.queryClient;
    // Unknown wallet ids fall back to all wallets.
    const account = deps.account
      ? resolveReportAccount(deps.account, await qc.ensureQueryData(rowsQuery("accounts")))
      : undefined;
    return qc.ensureQueryData(yearlyQuery(currentMonth().slice(0, 4), account));
  },
  errorComponent: RouteError,
  pendingComponent: RekapSkeleton,
  pendingMs: PENDING_MS,
  component: RekapPage,
});

function RekapPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [year, setYear] = useState(currentMonth().slice(0, 4));
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as { id: string; name: string }[];
  const account = resolveReportAccount(search.account, accounts);
  const setAccount = (a: string | undefined) =>
    void navigate({ search: a ? { account: a } : {}, replace: true });
  const { data: d } = useQuery({ ...yearlyQuery(year, account), placeholderData: (p) => p });
  const catName = (name: string) => (isTransferCategory(name) ? t(name) : name);
  if (!d) return <RekapSkeleton />;

  return (
    <>
      <PageHeader
        title={t("Rekap Tahunan")}
        subtitle={t("Gambaran besar keuangan Anda selama setahun penuh.")}
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> {t("Cetak PDF")}
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setYear(String(Number(year) - 1))}
            aria-label={t("Sebelumnya")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="min-w-24 text-center font-display text-lg font-semibold">{year}</p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setYear(String(Number(year) + 1))}
            aria-label={t("Berikutnya")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <WalletFilter
          value={account}
          accounts={accounts}
          onChange={setAccount}
          className="sm:ml-auto"
        />
        {account ? (
          <p className="w-full text-xs text-muted-foreground sm:text-right">
            {t("Transfer dihitung sebagai uang masuk/keluar dompet ini.")}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Total pemasukan")}
          </p>
          <p className="num mt-2 break-words text-xl font-semibold text-income sm:text-2xl">
            {money(d.income)}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {t("Rata-rata ")}
            {money(d.avgIncome)}/{t("bln")}
          </p>
        </Card>
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Total pengeluaran")}
          </p>
          <p className="num mt-2 break-words text-xl font-semibold text-expense sm:text-2xl">
            {money(d.expense)}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {t("Rata-rata ")}
            {money(d.avgExpense)}/{t("bln")}
          </p>
        </Card>
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Selisih setahun")}
          </p>
          <p
            className={`num mt-2 break-words text-xl font-semibold sm:text-2xl ${d.net >= 0 ? "text-income" : "text-expense"}`}
          >
            {money(d.net)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.net >= 0 ? t("Surplus") : t("Defisit")} {money(Math.abs(d.net / 12))}/{t("bln")}
          </p>
        </Card>
        <Card className="min-w-0 bg-ink p-5 text-ink-foreground">
          <p className="text-xs uppercase tracking-wider text-ink-muted">{t("Rasio menabung")}</p>
          <p className="num mt-2 text-2xl font-semibold">
            {d.income > 0 ? `${Math.round((d.net / d.income) * 100)}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">{t("dari total pemasukan")}</p>
        </Card>
      </div>

      <Card className="mt-4 min-w-0 p-5">
        <h2 className="mb-4 text-lg font-semibold">{t("Arus kas per bulan")}</h2>
        <div className="h-72 short:h-52">
          <CashflowBarChart
            data={d.months.map((m: any) => ({ ...m, label: shortMonth(m.month, locale) }))}
            incomeLabel={t("Pemasukan")}
            expenseLabel={t("Pengeluaran")}
          />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="min-w-0 p-5">
          <h2 className="mb-2 text-lg font-semibold">{t("Pengeluaran per kategori (setahun)")}</h2>
          {d.byCategory.length ? (
            <div className="h-64 short:h-52">
              <DonutChart
                data={d.byCategory.slice(0, 8).map((c: any, i: number) => ({
                  name: catName(c.name),
                  value: c.value,
                  color: c.color ?? PIE[i % PIE.length],
                }))}
                innerRadius={55}
                outerRadius={95}
                styledTooltip={false}
              />
            </div>
          ) : (
            <Empty text={t("Belum ada pengeluaran tahun ini.")} />
          )}
        </Card>
        <Card className="min-w-0 p-5">
          <h2 className="mb-3 text-lg font-semibold">{t("Kategori terbesar")}</h2>
          {d.byCategory.length ? (
            <ul className="space-y-2 text-sm">
              {d.byCategory.slice(0, 10).map((c: any, i: number) => (
                <li key={i} className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="num w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: c.color ?? PIE[i % PIE.length] }}
                    />
                    <span className="truncate">{catName(c.name)}</span>
                  </span>
                  <span className="num shrink-0 text-muted-foreground">{money(c.value)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t("Belum ada data.")} />
          )}
        </Card>
      </div>
    </>
  );
}
