import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { Empty } from "@/components/crud-page";
import { Pagination } from "@/components/pagination";
import { BalanceLineChart, DonutChart } from "@/components/charts";
import { CHART_PALETTE as PIE } from "@/components/charts/shared";
import { TransactionDialog, newTxDraft, type TxDraft } from "@/components/transaction-dialog";
import { AccountReconcile } from "@/components/account-reconcile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { accountReportQuery, txCountQuery, txQuery } from "@/lib/queries";
import { currentMonth, dateLabel, monthLabel, shiftMonth, shortMonth } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { signedAmount, TRANSFER_OUT } from "@/lib/account-report";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { useAccess } from "@/hooks/use-access";
import { walletLabel } from "@/lib/permissions";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/accounts_/$id")({
  head: () => pageHead("Detail akun", "Saldo, arus kas, dan rekonsiliasi per akun."),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(accountReportQuery(params.id, currentMonth())),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: AccountDetailPage,
});

function AccountDetailPage() {
  usePrivacy();
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [month, setMonth] = useState(currentMonth());
  const [offset, setOffset] = useState(0);
  const [dlg, setDlg] = useState<{ open: boolean; draft: TxDraft; id: string | null }>({
    open: false,
    draft: newTxDraft(),
    id: null,
  });
  const { data: r } = useQuery({
    ...accountReportQuery(id, month),
    placeholderData: (p) => p,
  });
  const filter = { month, account_id: id };
  const { data: rows = [] } = useQuery({
    ...txQuery({ ...filter, offset }),
    placeholderData: (p) => p,
  });
  const { data: total = 0 } = useQuery({ ...txCountQuery(filter), placeholderData: (p) => p });
  // v18: recording needs manage on this wallet; reconciliation is admin-only.
  const { isAdmin, can } = useAccess();
  const canManage = can("wallet:manage", id);
  if (!r) return <PageSkeleton />;
  const cur: string = r.account.currency;
  const list = (rows as any[]).slice(0, PAGE_SIZE);
  const goMonth = (m: string) => {
    setMonth(m);
    setOffset(0);
  };
  const s = r.summary;

  return (
    <>
      <PageHeader
        title={r.account.name}
        subtitle={t("Saldo dihitung otomatis dari saldo awal + semua transaksi.")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/accounts">
                <ArrowLeft className="size-4" /> {t("Akun")}
              </Link>
            </Button>
            {canManage ? (
              <Button
                onClick={() =>
                  setDlg({ open: true, draft: { ...newTxDraft(), account_id: id }, id: null })
                }
              >
                <Plus className="size-4" /> {t("Catat")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge variant="outline">{cur}</Badge>
        {r.account.archived ? <Badge variant="outline">{t("Arsip")}</Badge> : null}
        {r.reconciliation?.last ? (
          <Badge variant="secondary">
            {t("Terakhir direkonsiliasi")} {dateLabel(r.reconciliation.last.as_of, locale)}
          </Badge>
        ) : null}
      </div>

      <div className="mb-5 flex items-center justify-between gap-2 sm:justify-start">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => goMonth(shiftMonth(month, -1))}
          aria-label={t("Sebelumnya")}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 text-center font-display text-lg font-semibold capitalize sm:min-w-40 sm:flex-none">
          {monthLabel(month, locale)}
        </p>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => goMonth(shiftMonth(month, 1))}
          aria-label={t("Berikutnya")}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("Saldo awal bulan")} value={money(s.opening, cur)} />
        <Stat label={t("Uang masuk")} value={money(s.inflow, cur)} tone="text-income" />
        <Stat label={t("Uang keluar")} value={money(s.outflow, cur)} tone="text-expense" />
        <Stat
          label={t("Saldo akhir bulan")}
          value={money(s.closing, cur)}
          tone={s.closing < 0 ? "text-expense" : ""}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("Uang masuk/keluar termasuk transfer antar akun dan biaya admin.")}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-5 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">{t("Saldo 12 bulan")}</h2>
          <div className="h-64 short:h-48">
            <BalanceLineChart
              data={r.series.map((p: any) => ({ ...p, label: shortMonth(p.month, locale) }))}
              label={t("Saldo")}
              currency={cur}
            />
          </div>
        </Card>
        <Card className="min-w-0 p-5">
          <h2 className="mb-2 text-lg font-semibold">{t("Uang keluar per kategori")}</h2>
          {r.byCategory.length ? (
            <>
              <div className="h-40">
                <DonutChart
                  data={r.byCategory.map((c: any, i: number) => ({
                    name: c.name === TRANSFER_OUT ? t(TRANSFER_OUT) : c.name,
                    value: c.value,
                    color: c.color ?? PIE[i % PIE.length],
                  }))}
                  innerRadius={42}
                  outerRadius={70}
                />
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {r.byCategory.slice(0, 6).map((c: any, i: number) => (
                  <li key={c.name} className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: c.color ?? PIE[i % PIE.length] }}
                      />
                      {c.name === TRANSFER_OUT ? t(TRANSFER_OUT) : c.name}
                    </span>
                    <span className="num shrink-0 text-muted-foreground">
                      {money(c.value, cur)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty text={t("Belum ada uang keluar bulan ini.")} />
          )}
        </Card>
      </div>

      {isAdmin ? (
        <AccountReconcile
          accountId={id}
          currency={cur}
          ready={!!r.reconciliation?.ready}
          last={r.reconciliation?.last ?? null}
          onRecord={(draft) => setDlg({ open: true, draft, id: null })}
        />
      ) : null}

      <Card className="mt-4 min-w-0 p-0">
        <h2 className="p-5 pb-2 text-lg font-semibold">{t("Transaksi akun")}</h2>
        {list.length === 0 ? (
          <div className="p-5 pt-0">
            <Empty text={t("Belum ada transaksi bulan ini.")} />
          </div>
        ) : (
          <ul className="divide-y">
            {list.map((tx: any) => {
              const v = signedAmount(tx, id);
              const other =
                tx.kind === "transfer"
                  ? tx.account_id === id
                    ? `→ ${walletLabel(tx.to_account, t)}`
                    : `← ${walletLabel(tx.account, t)}`
                  : (tx.category?.name ?? t("Tanpa kategori"));
              return (
                <li
                  key={tx.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {tx.description ||
                        tx.merchant ||
                        t(
                          tx.kind === "income"
                            ? "Pemasukan"
                            : tx.kind === "expense"
                              ? "Pengeluaran"
                              : "Transfer",
                        )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {dateLabel(tx.occurred_at, locale)} · {other}
                    </span>
                  </span>
                  <span
                    className={`num shrink-0 font-semibold ${v >= 0 ? "text-income" : "text-expense"}`}
                  >
                    {v >= 0 ? "+" : "−"}
                    {money(Math.abs(v), cur)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Pagination
        offset={offset}
        pageSize={PAGE_SIZE}
        total={total}
        visible={list.length}
        onChange={setOffset}
      />
      <TransactionDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg((d) => ({ ...d, open: o }))}
        initial={dlg.draft}
        id={dlg.id}
      />
    </>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="min-w-0 p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`num mt-2 break-words text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}
