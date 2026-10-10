import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Plus, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { CURRENCY_OPTIONS } from "@/components/entity-dialog";
import { Empty, RowActions, useCrudDialog } from "@/components/crud-page";
import { useConfirm } from "@/components/confirm-dialog";
import { Pagination } from "@/components/pagination";
import { useClientPage } from "@/hooks/use-client-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { debtsQuery, errMsg, rowsQuery, invalidateFor } from "@/lib/queries";
import { deleteRow, payDebt } from "@/lib/finance.functions";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account } from "@/lib/schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Two-column card grid on desktop: an even size keeps the last row full. */
const PAGE_SIZE = 10;

export const Route = createFileRoute("/_app/debts")({
  head: () =>
    pageHead("Hutang & Cicilan", "Pantau paylater, pinjaman, dan cicilan beserta jatuh temponya."),
  loader: ({ context }) => context.queryClient.ensureQueryData(debtsQuery()),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: DebtsPage,
});

function DebtsPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const { data: debts } = useSuspenseQuery(debtsQuery());
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const pay = useServerFn(payDebt);
  const del = useServerFn(deleteRow);
  const qc = useQueryClient();
  const crud = useCrudDialog("debts", {
    kind: "paylater",
    currency: "IDR",
    start_date: todayStr(),
    due_day: 5,
    total_installments: 3,
    status: "active",
  });
  const ask = useConfirm();
  const KINDS = [
    { value: "paylater", label: t("Paylater") },
    { value: "loan", label: t("Pinjaman") },
    { value: "credit_card", label: t("Cicilan kartu kredit") },
    { value: "personal", label: t("Hutang pribadi") },
    { value: "other", label: t("Lainnya") },
  ];
  const active = (debts as any[]).filter((d) => d.status === "active");
  const totalRemaining = active.reduce(
    (a, d) => a + (d.currency === "IDR" ? d.remaining_amount : 0),
    0,
  );
  const page = useClientPage(debts as any[], PAGE_SIZE);

  async function doPay(d: any) {
    if (
      !(await ask.confirm(`${t("Catat pembayaran cicilan ke-")}${d.paid_count + 1}${t("?")}`, {
        description: `${d.name} · ${money(d.installment_amount, d.currency)} — ${t("otomatis tercatat sebagai pengeluaran.")}`,
        confirmLabel: t("Ya, catat"),
      }))
    )
      return;
    try {
      await pay({ data: { debt_id: d.id } });
      await invalidateFor(qc, "debt_payments");
      toast.success(t("Cicilan tercatat & masuk ke pengeluaran"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  async function undo(id: string) {
    if (
      !(await ask.confirm(t("Batalkan pembayaran ini?"), {
        description: t("Transaksi pengeluaran terkait juga akan dihapus."),
        confirmLabel: t("Ya, batalkan"),
        destructive: true,
      }))
    )
      return;
    try {
      await del({ data: { table: "debt_payments", id } });
      await invalidateFor(qc, "debt_payments");
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <>
      <PageHeader
        title={t("Hutang & Cicilan")}
        subtitle={`${t("Sisa kewajiban (IDR):")} ${money(totalRemaining)}`}
        actions={
          <Button onClick={() => crud.openNew()}>
            <Plus className="size-4" /> {t("Tambah")}
          </Button>
        }
      />
      {debts.length === 0 ? (
        <Empty
          text={t("Belum ada hutang/cicilan. Tambahkan paylater, KTA, atau pinjaman teman.")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {page.visible.map((d) => {
            const pct = (d.paid_count / d.total_installments) * 100;
            return (
              <Card key={d.id} className="min-w-0 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-semibold">{d.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {KINDS.find((k) => k.value === d.kind)?.label}
                      </Badge>
                      {d.provider ? <Badge variant="outline">{d.provider}</Badge> : null}
                      {d.status === "paid_off" ? (
                        <Badge className="bg-income text-primary-foreground">{t("Lunas")}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <RowActions
                    onEdit={() =>
                      crud.openEdit({
                        id: d.id,
                        name: d.name,
                        provider: d.provider,
                        kind: d.kind,
                        currency: d.currency,
                        total_amount: d.total_amount,
                        installment_amount: d.installment_amount,
                        total_installments: d.total_installments,
                        start_date: d.start_date,
                        due_day: d.due_day,
                        interest_rate: d.interest_rate,
                        account_id: d.account_id,
                        notes: d.notes,
                        status: d.status,
                      })
                    }
                    onDelete={() => crud.remove(d.id, d.name)}
                  />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 text-sm min-[430px]:grid-cols-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("Per cicilan")}</p>
                    <p className="num break-words font-semibold">
                      {money(d.installment_amount, d.currency)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("Sisa")}</p>
                    <p className="num break-words font-semibold text-expense">
                      {money(d.remaining_amount, d.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Jatuh tempo")}</p>
                    <p className="font-semibold">
                      {d.next_due ? dateLabel(d.next_due, lang === "en" ? "en-US" : "id-ID") : "-"}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>
                      {d.paid_count}/{d.total_installments} {t("cicilan")}
                    </span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <Progress value={pct} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {d.status === "active" ? (
                    <Button size="sm" onClick={() => doPay(d)}>
                      <CheckCircle2 className="size-4" /> {t("Bayar cicilan ke-")}
                      {d.paid_count + 1}
                    </Button>
                  ) : null}
                  {d.payments.length ? (
                    <Collapsible className="w-full">
                      <CollapsibleTrigger className="text-xs text-primary">
                        {t("Riwayat pembayaran")} ({d.payments.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-2 divide-y rounded-lg border text-sm">
                          {d.payments.map((p: any) => (
                            <li
                              key={p.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5"
                            >
                              <span className="truncate">
                                #{p.installment_no} ·{" "}
                                {dateLabel(p.paid_at, lang === "en" ? "en-US" : "id-ID")}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="num">{money(p.amount, d.currency)}</span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-9 sm:size-7"
                                  aria-label={t("Batalkan")}
                                  onClick={() => undo(p.id)}
                                >
                                  <Undo2 className="size-3.5" />
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Pagination
        offset={page.offset}
        pageSize={page.pageSize}
        total={page.total}
        visible={page.visible.length}
        onChange={page.setOffset}
      />
      {crud.dialog(t("hutang / cicilan"), [
        {
          name: "name",
          label: t("Nama"),
          type: "text",
          placeholder: "HP baru via Shopee PayLater",
        },
        { name: "kind", label: t("Jenis"), type: "select", half: true, options: KINDS },
        {
          name: "provider",
          label: t("Penyedia"),
          type: "text",
          half: true,
          placeholder: "Kredivo, Akulaku, Bank…",
        },
        { name: "total_amount", label: t("Total pinjaman"), type: "number", half: true },
        {
          name: "currency",
          label: t("Mata uang"),
          type: "select",
          half: true,
          options: CURRENCY_OPTIONS,
        },
        { name: "installment_amount", label: t("Cicilan per bulan"), type: "number", half: true },
        {
          name: "total_installments",
          label: t("Jumlah cicilan (bulan)"),
          type: "number",
          half: true,
        },
        { name: "start_date", label: t("Bulan cicilan pertama"), type: "date", half: true },
        { name: "due_day", label: t("Tanggal jatuh tempo (1-31)"), type: "number", half: true },
        { name: "interest_rate", label: t("Bunga % (opsional)"), type: "number", half: true },
        {
          name: "account_id",
          label: t("Dibayar dari akun"),
          type: "select",
          half: true,
          options: [
            { value: "", label: "—" },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ],
        },
        {
          name: "status",
          label: t("Status"),
          type: "select",
          half: true,
          options: [
            { value: "active", label: t("Aktif") },
            { value: "paid_off", label: t("Lunas") },
          ],
        },
        { name: "notes", label: t("Catatan"), type: "textarea" },
      ])}
      {ask.element}
    </>
  );
}
