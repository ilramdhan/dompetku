import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { SortButton, type SortDirection } from "@/components/sort-button";
import { Empty } from "@/components/crud-page";
import { WalletFilter } from "@/components/wallet-filter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { invoicePaymentsQuery, invoiceReportQuery, rowsQuery } from "@/lib/queries";
import {
  AGING_LABEL,
  validateInvoiceReportSearch,
  type AgingBucket,
  type PaymentSort,
  type WalletRow,
} from "@/lib/invoice-report";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/invoices";
import { resolveReportAccount } from "@/lib/report-filter";
import { currentMonth, dateLabel, monthLabel, shiftMonth } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account } from "@/lib/schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGE_SIZE = 20;

export const Route = createFileRoute("/_app/invoices_/report")({
  head: () =>
    pageHead("Laporan invoice", "Ringkasan tagihan, umur piutang (aging), dan riwayat pembayaran."),
  validateSearch: validateInvoiceReportSearch,
  loaderDeps: ({ search }) => ({ account: search.account, month: search.month }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(invoiceReportQuery(deps.month, deps.account)),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: InvoiceReportPage,
});

/** Bucket colors: from calm to alarming, semantic tokens only. */
const BUCKET_BAR: Record<string, string> = {
  current: "bg-income",
  d1_30: "bg-warning",
  d31_60: "bg-warning",
  d61_90: "bg-expense",
  d90plus: "bg-expense",
};

function InvoiceReportPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const accounts = ((useQuery(rowsQuery("accounts")).data ?? []) as Account[]).filter(
    (a) => a.currency === "IDR",
  );
  const account = resolveReportAccount(search.account, accounts);
  const month = search.month ?? currentMonth();
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<PaymentSort>("paid_at");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const go = (next: { account?: string | undefined; month?: string | undefined }) => {
    setOffset(0);
    const m = { account, month: search.month, ...next };
    void navigate({
      search: {
        ...(m.account ? { account: m.account } : {}),
        ...(m.month && m.month !== currentMonth() ? { month: m.month } : {}),
      },
      replace: true,
    });
  };

  const { data } = useQuery({
    ...invoiceReportQuery(search.month, account),
    placeholderData: (p) => p,
  });
  const { data: pays } = useQuery({
    ...invoicePaymentsQuery({
      offset,
      limit: PAGE_SIZE,
      sort,
      direction,
      month,
      ...(account ? { account } : {}),
    }),
    placeholderData: (p) => p,
  });
  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "-";

  const header = (
    <PageHeader
      title={t("Laporan invoice")}
      subtitle={t("Ringkasan tagihan, umur piutang (aging), dan riwayat pembayaran.")}
      actions={
        <Button variant="outline" asChild>
          <Link to="/invoices" search={account ? { account } : {}}>
            <ArrowLeft className="size-4" /> {t("Invoice")}
          </Link>
        </Button>
      }
    />
  );
  if (!data) return null;
  if (!data.ready) {
    return (
      <>
        {header}
        <Empty text={t("Fitur invoice belum aktif: jalankan bagian v21 di supabase/schema.sql.")} />
      </>
    );
  }
  const s = data.summary as {
    issued: number;
    issuedCount: number;
    received: number;
    receivedCount: number;
    outstanding: number;
    outstandingCount: number;
    byWallet: WalletRow[];
  };
  const aging = data.aging as {
    buckets: AgingBucket[];
    total: number;
    count: number;
    overdue: number;
    overdueCount: number;
  };
  const max = Math.max(1, ...aging.buckets.map((b) => b.amount));
  const payItems = (pays?.ready ? pays.items : []) as any[];

  function sortBy(column: PaymentSort) {
    setDirection((cur) => (sort === column ? (cur === "asc" ? "desc" : "asc") : "desc"));
    setSort(column);
    setOffset(0);
  }

  return (
    <>
      {header}
      <div className="no-print mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => go({ month: shiftMonth(month, -1) })}
            aria-label={t("Sebelumnya")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="min-w-36 text-center font-display text-lg font-semibold capitalize">
            {monthLabel(month, locale)}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => go({ month: shiftMonth(month, 1) })}
            aria-label={t("Berikutnya")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <WalletFilter value={account} accounts={accounts} onChange={(a) => go({ account: a })} />
      </div>

      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 xl:grid-cols-3">
        <Card className="min-w-0 p-4">
          <p className="text-xs text-muted-foreground">{t("Diterbitkan")}</p>
          <p className="num break-words text-xl font-semibold">{money(s.issued)}</p>
          <p className="text-xs text-muted-foreground">
            {s.issuedCount} {t("invoice")}
          </p>
        </Card>
        <Card className="min-w-0 p-4">
          <p className="text-xs text-muted-foreground">{t("Diterima")}</p>
          <p className="num break-words text-xl font-semibold text-income">{money(s.received)}</p>
          <p className="text-xs text-muted-foreground">
            {s.receivedCount} {t("pembayaran")}
          </p>
        </Card>
        <Card className="min-w-0 p-4 min-[430px]:col-span-2 xl:col-span-1">
          <p className="text-xs text-muted-foreground">{t("Outstanding akhir periode")}</p>
          <p className="num break-words text-xl font-semibold">{money(s.outstanding)}</p>
          <p className="text-xs text-muted-foreground">
            {s.outstandingCount} {t("invoice belum lunas")}
          </p>
        </Card>
      </div>

      <Card className="mt-4 min-w-0 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("Umur piutang (aging)")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Per hari ini")} · {aging.count} {t("invoice belum lunas")} ·{" "}
            <span className="num">{money(aging.total)}</span>
          </p>
        </div>
        {aging.count === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("Tidak ada invoice yang belum lunas.")}
          </p>
        ) : (
          <ul className="space-y-3">
            {aging.buckets.map((b) => (
              <li key={b.key} className="min-w-0">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span>{t(AGING_LABEL[b.key])}</span>
                  <span className="num min-w-0 break-words font-medium">
                    {money(b.amount)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({b.count} {t("invoice")})
                    </span>
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${t(AGING_LABEL[b.key])}: ${b.count}`}
                >
                  <div
                    className={`h-full rounded-full ${BUCKET_BAR[b.key]}`}
                    style={{ width: `${(b.amount / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {s.byWallet.length > 0 ? (
        <Card className="mt-4 min-w-0 p-5">
          <h2 className="mb-3 text-lg font-semibold">{t("Per dompet")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("Dompet")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("Diterbitkan")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("Diterima")}</th>
                  <th className="py-2 text-right font-medium">{t("Outstanding")}</th>
                </tr>
              </thead>
              <tbody>
                {s.byWallet.map((w) => (
                  <tr key={w.account_id ?? "none"} className="border-b last:border-0">
                    <td className="py-2 pr-3">{accName(w.account_id)}</td>
                    <td className="num py-2 pr-3 text-right">{money(w.issued)}</td>
                    <td className="num py-2 pr-3 text-right text-income">{money(w.received)}</td>
                    <td className="num py-2 text-right font-medium">{money(w.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card className="mt-4 min-w-0 p-5">
        <h2 className="mb-3 text-lg font-semibold">
          {t("Pembayaran diterima")} ·{" "}
          <span className="capitalize">{monthLabel(month, locale)}</span>
        </h2>
        {pays && pays.ready && payItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("Belum ada pembayaran pada periode ini.")}
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1 text-xs">
              <SortButton
                label={t("Tanggal")}
                active={sort === "paid_at"}
                direction={direction}
                onClick={() => sortBy("paid_at")}
              />
              <SortButton
                label={t("Jumlah")}
                active={sort === "amount"}
                direction={direction}
                onClick={() => sortBy("amount")}
              />
            </div>
            <ul className="divide-y">
              {payItems.map((p) => (
                <li
                  key={p.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      to="/invoices"
                      search={{ ...(account ? { account } : {}) }}
                      className="font-medium hover:underline"
                    >
                      {p.number}
                    </Link>
                    <p className="break-words text-xs text-muted-foreground">
                      {p.customer_name} · {dateLabel(p.paid_at, locale)} ·{" "}
                      {t(METHOD_LABEL[p.method as PaymentMethod] ?? p.method)}
                      {p.reference ? ` · ${p.reference}` : ""} · {accName(p.account_id)}
                    </p>
                  </div>
                  <p className="num font-semibold text-income">{money(p.amount)}</p>
                </li>
              ))}
            </ul>
            <Pagination
              offset={offset}
              pageSize={PAGE_SIZE}
              total={pays?.ready ? pays.total : 0}
              visible={payItems.length}
              onChange={setOffset}
            />
          </>
        )}
      </Card>
    </>
  );
}
