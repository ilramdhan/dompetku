import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { TransactionDialog, newTxDraft, type TxDraft } from "@/components/transaction-dialog";
import { AssetsOverview } from "@/components/assets-overview";
import {
  CashflowAreaChart,
  DonutChart,
  NetWorthChart,
  StackedAreaChart,
} from "@/components/charts";
import { CHART_PALETTE as PIE } from "@/components/charts/shared";
import { PENDING_MS, DashboardSkeleton } from "@/components/skeletons";
import { ReceiptScanner } from "@/components/receipt-scanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { dashboardQuery, netWorthQuery } from "@/lib/queries";
import { currentMonth, dateLabel, monthLabel, shiftMonth, shortMonth, todayStr } from "@/lib/dates";
import { projectGoal } from "@/lib/goals";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { formatPercent, monthChange, previousOf, savingsRate } from "@/lib/ratio";
import { IncomeRatioCard } from "@/components/income-ratio-card";
import { PocketWarnings } from "@/components/pocket-warnings";
import { useAccess } from "@/hooks/use-access";
import { walletLabel } from "@/lib/permissions";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const Route = createFileRoute("/_app/dashboard")({
  head: () =>
    pageHead(
      "Dashboard",
      "Ringkasan pemasukan, pengeluaran, saldo, hutang, dan pengingat bulan ini.",
    ),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery(currentMonth())),
  errorComponent: RouteError,
  pendingComponent: DashboardSkeleton,
  pendingMs: PENDING_MS,
  component: Dashboard,
});

function Dashboard() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [month, setMonth] = useState(currentMonth());
  const { data: d } = useQuery({ ...dashboardQuery(month), placeholderData: (p) => p });
  const { data: nw } = useQuery(netWorthQuery(12, month));
  // v18 members: only their permitted wallets; debts/goals/budgets/reminders/assets are admin-only.
  const { isAdmin, access } = useAccess();
  const canWrite = isAdmin || Object.values(access.grants).includes("manage");
  const [dlg, setDlg] = useState<{ open: boolean; draft: TxDraft }>({
    open: false,
    draft: newTxDraft(),
  });
  if (!d) return <DashboardSkeleton />;
  const prev = previousOf<{ income: number; expense: number }>(d.trend);
  const rate = savingsRate(d.net, d.income);

  return (
    <>
      <PageHeader
        title={t("Dashboard")}
        subtitle={`${t("Kurs hari ini: 1 USD = ")}${money(d.usdIdr)}`}
        actions={
          canWrite ? (
            <>
              {isAdmin ? (
                <ReceiptScanner onDraft={(draft) => setDlg({ open: true, draft })} />
              ) : null}
              <Button
                variant="secondary"
                onClick={() => setDlg({ open: true, draft: newTxDraft("income") })}
              >
                <Plus className="size-4" /> {t("Pemasukan")}
              </Button>
              <Button onClick={() => setDlg({ open: true, draft: newTxDraft("expense") })}>
                <Plus className="size-4" /> {t("Pengeluaran")}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-5 flex items-center justify-between gap-2 sm:justify-start">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={t("Sebelumnya")}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 text-center font-display sm:min-w-40 sm:flex-none text-lg font-semibold capitalize">
          {monthLabel(month, locale)}
        </p>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label={t("Berikutnya")}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex min-w-0 flex-col bg-ink p-5 text-ink-foreground">
          <p className="text-xs uppercase tracking-wider text-ink-muted">{t("Total saldo")}</p>
          <p className="num mt-2 break-words text-2xl font-semibold">{money(d.totalBalanceIdr)}</p>
          <p className="mt-auto pt-3 text-xs text-ink-muted">
            {d.balances.length} {t("akun aktif")}
          </p>
        </Card>
        <Stat
          label={t("Pemasukan")}
          value={d.income}
          tone="income"
          icon={<ArrowDownRight className="size-4" />}
          footer={<MonthDelta current={d.income} previous={prev?.income} goodWhenUp />}
        />
        <Stat
          label={t("Pengeluaran")}
          value={d.expense}
          tone="expense"
          icon={<ArrowUpRight className="size-4" />}
          footer={<MonthDelta current={d.expense} previous={prev?.expense} goodWhenUp={false} />}
        />
        <Card className="flex min-w-0 flex-col p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Selisih bulan ini")}
          </p>
          <p
            className={`num mt-2 break-words text-2xl font-semibold ${d.net >= 0 ? "text-income" : "text-expense"}`}
          >
            {money(d.net)}
          </p>
          <div className="mt-auto space-y-0.5 pt-3 text-xs text-muted-foreground">
            {rate !== null ? (
              <p>
                <span className={`num font-medium ${rate >= 0 ? "text-income" : "text-expense"}`}>
                  {formatPercent(rate)}
                </span>{" "}
                {t("dari pemasukan")}
              </p>
            ) : null}
            <p className="break-words">
              {isAdmin ? (
                <>
                  {t("Hutang")} <span className="num">{money(d.debtOutstandingIdr)}</span> ·{" "}
                  {t("Langganan")} <span className="num">{money(d.subsMonthlyIdr)}</span>/{t("bln")}
                </>
              ) : null}
              {d.feesIdr > 0 ? (
                <>
                  {isAdmin ? " · " : null}
                  {t("Admin")} <span className="num">{money(d.feesIdr)}</span>
                </>
              ) : null}
            </p>
          </div>
        </Card>
      </div>

      <IncomeRatioCard
        className="mt-4"
        income={d.income}
        expense={d.expense}
        categories={d.byCategory}
      />

      {month === currentMonth() ? <PocketWarnings month={month} /> : null}

      {isAdmin ? <AssetsOverview /> : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-5 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">{t("Arus kas 6 bulan")}</h2>
          <div className="h-64 short:h-48">
            <CashflowAreaChart
              data={d.trend.map((t: any) => ({ ...t, label: shortMonth(t.month, locale) }))}
              incomeLabel={t("Pemasukan")}
              expenseLabel={t("Pengeluaran")}
            />
          </div>
        </Card>
        <Card className="min-w-0 p-5">
          <h2 className="mb-2 text-lg font-semibold">{t("Pengeluaran per kategori")}</h2>
          {d.byCategory.length ? (
            <>
              <div className="h-40">
                <DonutChart
                  data={d.byCategory.map((c: any, i: number) => ({
                    name: c.name,
                    value: c.value,
                    color: c.color ?? PIE[i % PIE.length],
                  }))}
                  innerRadius={42}
                  outerRadius={70}
                />
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {d.byCategory.slice(0, 5).map((c: any, i: number) => (
                  <li key={i} className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: c.color ?? PIE[i % PIE.length] }}
                      />
                      {c.name}
                    </span>
                    <span className="num shrink-0 text-muted-foreground">{money(c.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty text={t("Belum ada pengeluaran bulan ini.")} />
          )}
        </Card>
      </div>

      {d.categoryTrend?.categories?.length ? (
        <Card className="mt-4 min-w-0 p-5">
          <h2 className="mb-4 text-lg font-semibold">
            {t("Tren pengeluaran per kategori (6 bulan)")}
          </h2>
          <div className="h-64 short:h-48">
            <StackedAreaChart
              data={d.categoryTrend.rows.map((r: any) => ({
                ...r,
                label: shortMonth(r.month, locale),
              }))}
              keys={d.categoryTrend.categories}
            />
          </div>
        </Card>
      ) : null}

      {nw?.length ? (
        <Card className="mt-4 min-w-0 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {isAdmin ? t("Kekayaan bersih (12 bulan)") : t("Saldo dompet (12 bulan)")}
            </h2>
            <div className="min-w-0 text-right">
              <p className="num break-words text-lg font-semibold">
                {money(nw[nw.length - 1]!.netWorth)}
              </p>
              {nw[nw.length - 1]!.gold > 0 ? (
                <p className="num text-xs text-muted-foreground">
                  {t("termasuk emas")} {money(nw[nw.length - 1]!.gold)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="h-56 short:h-44">
            <NetWorthChart
              data={nw.map((r) => ({ ...r, label: shortMonth(r.month, locale) }))}
              label={isAdmin ? t("Kekayaan bersih (12 bulan)") : t("Saldo dompet (12 bulan)")}
            />
          </div>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {isAdmin ? (
          <>
            <Card className="min-w-0 p-5">
              <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-lg font-semibold">{t("Pengingat")}</h2>
                <Link to="/reminders" className="shrink-0 text-xs text-primary">
                  {t("Semua")}
                </Link>
              </div>
              {d.reminders.length ? (
                <ul className="space-y-3">
                  {d.reminders.map((r: any) => (
                    <li
                      key={r.type + r.id}
                      className="flex min-w-0 items-start justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 font-medium">
                          {r.overdue ? (
                            <AlertTriangle className="size-3.5 shrink-0 text-expense" />
                          ) : null}
                          <span className="truncate">{r.title}</span>
                        </p>
                        <p
                          className={`text-xs ${r.overdue ? "text-expense" : "text-muted-foreground"}`}
                        >
                          {r.type === "budget"
                            ? t("Peringatan budget")
                            : r.overdue
                              ? `${t("terlambat ")}${-r.days_left} ${t("hari")}`
                              : r.days_left === 0
                                ? t("Hari ini")
                                : `${r.days_left} ${t("hari lagi")} · ${dateLabel(r.due_date, locale)}`}
                        </p>
                      </div>
                      <span className="num shrink-0">{money(r.amount, r.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty text={t("Tidak ada tagihan 14 hari ke depan.")} />
              )}
            </Card>
            <Card className="min-w-0 p-5">
              <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-lg font-semibold">{t("Budget")}</h2>
                <Link to="/budgets" className="shrink-0 text-xs text-primary">
                  {t("Atur")}
                </Link>
              </div>
              {d.budgets.length ? (
                <ul className="space-y-3">
                  {d.budgets.map((b: any) => (
                    <li key={b.id} className="min-w-0 text-sm">
                      <div className="mb-1 flex min-w-0 justify-between gap-2">
                        <span className="min-w-0 truncate">{b.category}</span>
                        <span
                          className={`num shrink-0 ${b.percent >= 100 ? "text-expense" : "text-muted-foreground"}`}
                        >
                          {Math.round(b.percent)}%
                        </span>
                      </div>
                      <Progress
                        value={Math.min(100, b.percent)}
                        aria-label={`${b.category} ${Math.round(b.percent)}%`}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty text={t("Belum ada budget.")} />
              )}
            </Card>
          </>
        ) : null}
        <Card className="min-w-0 p-5">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-lg font-semibold">{t("Saldo akun")}</h2>
            <Link to="/accounts" className="shrink-0 text-xs text-primary">
              {t("Kelola")}
            </Link>
          </div>
          {d.balances.length ? (
            <ul className="space-y-2 text-sm">
              {d.balances.map((a: any) => (
                <li key={a.id} className="flex min-w-0 justify-between gap-2">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="num shrink-0">{money(a.balance, a.currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t("Tambahkan akun bank / e-wallet.")} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-5 lg:col-span-2">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-lg font-semibold">{t("Transaksi terbaru")}</h2>
            <Link to="/transactions" className="shrink-0 text-xs text-primary">
              {t("Semua")}
            </Link>
          </div>
          {d.recent.length ? (
            <ul className="divide-y">
              {d.recent.map((t2: any) => (
                <li
                  key={t2.id}
                  className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {t2.description || t2.merchant || t2.category?.name || "Transaksi"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dateLabel(t2.occurred_at, locale)} ·{" "}
                      {t2.category?.name ?? (t2.kind === "transfer" ? t("Transfer") : "-")}
                      {t2.account ? ` · ${walletLabel(t2.account, t)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`num shrink-0 font-medium ${t2.kind === "income" ? "text-income" : t2.kind === "expense" ? "text-expense" : ""}`}
                  >
                    {t2.kind === "income" ? "+" : t2.kind === "expense" ? "−" : ""}
                    {money(t2.amount, t2.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text={t("Belum ada transaksi. Mulai catat sekarang!")} />
          )}
        </Card>
        {isAdmin ? (
          <Card className="min-w-0 p-5">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-lg font-semibold">{t("Target tabungan")}</h2>
              <Link to="/goals" className="shrink-0 text-xs text-primary">
                {t("Kelola")}
              </Link>
            </div>
            {d.goals.length ? (
              <ul className="space-y-3 text-sm">
                {d.goals.map((g: any) => {
                  const p = g.target_amount ? (g.saved_amount / g.target_amount) * 100 : 0;
                  return (
                    <li key={g.id} className="min-w-0">
                      <div className="mb-1 flex min-w-0 justify-between gap-2">
                        <span className="min-w-0 truncate">{g.name}</span>
                        <span className="num shrink-0 text-muted-foreground">{Math.round(p)}%</span>
                      </div>
                      <Progress
                        value={Math.min(100, p)}
                        aria-label={`${g.name} ${Math.round(p)}%`}
                      />
                      {(() => {
                        const need = projectGoal({
                          target: g.target_amount,
                          saved: g.saved_amount,
                          deadline: g.deadline,
                          today: todayStr(),
                          createdAt: g.created_at,
                        }).monthlyNeeded;
                        return need ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {t("Setor")} <span className="num">{money(need)}</span>/{t("bln")}
                          </p>
                        ) : null;
                      })()}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty text={t("Belum ada target.")} />
            )}
          </Card>
        ) : null}
      </div>

      <TransactionDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg((s) => ({ ...s, open: o }))}
        initial={dlg.draft}
      />
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
  footer,
}: {
  label: string;
  value: number;
  tone: "income" | "expense";
  icon: React.ReactNode;
  footer?: React.ReactNode;
}) {
  usePrivacy();
  return (
    <Card className="flex min-w-0 flex-col p-5">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <span className={tone === "income" ? "text-income" : "text-expense"}>{icon}</span>
        {label}
      </p>
      <p
        className={`num mt-2 break-words text-2xl font-semibold ${tone === "income" ? "text-income" : "text-expense"}`}
      >
        {money(value)}
      </p>
      {footer ? <div className="mt-auto pt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}

/** "▲ 12% vs bulan lalu" — tone follows whether the direction is good for this metric. */
function MonthDelta({
  current,
  previous,
  goodWhenUp,
}: {
  current: number;
  previous: number | undefined;
  goodWhenUp: boolean;
}) {
  const { t } = useI18n();
  const pct = monthChange(current, previous);
  if (pct === null) return <p>{t("Belum ada data bulan lalu")}</p>;
  const flat = Math.round(pct) === 0;
  const up = pct > 0;
  const tone = flat ? "" : up === goodWhenUp ? "text-income" : "text-expense";
  return (
    <p>
      <span className={`num font-medium ${tone}`}>
        <span aria-hidden="true">{flat ? "=" : up ? "▲" : "▼"}</span>
        <span className="sr-only">{flat ? t("Tetap") : up ? t("Naik") : t("Turun")}</span>{" "}
        {formatPercent(Math.abs(pct))}
      </span>{" "}
      {t("vs bulan lalu")}
    </p>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
