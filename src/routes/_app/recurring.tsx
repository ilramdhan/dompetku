import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Pause, Play, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { CURRENCY_OPTIONS } from "@/components/entity-dialog";
import { Empty, RowActions, useCrudDialog } from "@/components/crud-page";
import { Pagination } from "@/components/pagination";
import { useClientPage } from "@/hooks/use-client-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { errMsg, fxQuery, invalidateFor, recurringQuery, rowsQuery } from "@/lib/queries";
import { postRecurring, toggleRecurring } from "@/lib/recurring.functions";
import { monthlyEquivalent, type RecurringCycle } from "@/lib/recurring";
import { dateLabel, diffDays, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account, Category, Recurring } from "@/lib/schemas";

export const Route = createFileRoute("/_app/recurring")({
  head: () =>
    pageHead(
      "Transaksi Berulang",
      "Gaji, sewa, dan transfer rutin yang dicatat otomatis sesuai jadwal.",
    ),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(recurringQuery()),
      context.queryClient.ensureQueryData(fxQuery()),
    ]),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: RecurringPage,
});

const KIND_LABEL = { income: "Pemasukan", expense: "Pengeluaran", transfer: "Transfer" } as const;
const CYCLE_LABEL = { weekly: "Mingguan", monthly: "Bulanan", yearly: "Tahunan" } as const;
const CYCLE_UNIT = { weekly: "minggu", monthly: "bulan", yearly: "tahun" } as const;

/** Single-column row list. */
const PAGE_SIZE = 20;

function RecurringPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const data = useSuspenseQuery(recurringQuery()).data;
  const { usdIdr } = useSuspenseQuery(fxQuery()).data;
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const categories = (useQuery(rowsQuery("categories")).data ?? []) as Category[];
  const post = useServerFn(postRecurring);
  const toggle = useServerFn(toggleRecurring);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayStr();
  const crud = useCrudDialog("recurring_transactions", {
    kind: "expense",
    currency: "IDR",
    cycle: "monthly",
    interval: 1,
    start_date: today,
    auto_post: true,
    active: true,
  });
  // Hooks must run before the early return below; a missing table is an empty list.
  const page = useClientPage((data.ready ? data.rows : []) as unknown as Recurring[], PAGE_SIZE);

  if (!data.ready) {
    return (
      <>
        <PageHeader title={t("Transaksi Berulang")} />
        <Empty
          text={t(
            "Tabel transaksi berulang belum ada. Jalankan bagian v10 di supabase/schema.sql lewat SQL Editor Supabase.",
          )}
        />
      </>
    );
  }

  const rows = data.rows as unknown as Recurring[];
  const accName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name;
  const catName = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name;
  const toIdr = (r: Recurring) =>
    monthlyEquivalent(Number(r.amount), r.cycle as RecurringCycle, r.interval) *
    (r.currency === "USD" ? usdIdr : 1);
  const active = rows.filter((r) => r.active);
  const monthlyIn = active.filter((r) => r.kind === "income").reduce((a, r) => a + toIdr(r), 0);
  const monthlyOut = active.filter((r) => r.kind === "expense").reduce((a, r) => a + toIdr(r), 0);

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      await invalidateFor(qc, "recurring_transactions");
      toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const doPost = (r: Recurring) =>
    run(
      r.id,
      async () => {
        const res = await post({ data: { id: r.id } });
        if (!res.posted) toast.info(t("Sudah tercatat sebelumnya"));
      },
      t("Tercatat"),
    );
  const doToggle = (r: Recurring) =>
    run(
      r.id,
      () => toggle({ data: { id: r.id, active: !r.active } }),
      r.active ? t("Dijeda") : t("Dilanjutkan"),
    );

  const accOptions = [
    { value: "", label: "—" },
    ...accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <>
      <PageHeader
        title={t("Transaksi Berulang")}
        subtitle={t("Gaji, sewa, dan transfer rutin yang dicatat otomatis sesuai jadwal.")}
        actions={
          <Button onClick={() => crud.openNew()}>
            <Plus className="size-4" /> {t("Transaksi Berulang")}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Pemasukan rutin / bulan")}
          </p>
          <p className="num mt-1 break-words text-xl font-semibold text-income sm:text-2xl">
            {money(monthlyIn)}
          </p>
        </Card>
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Pengeluaran rutin / bulan")}
          </p>
          <p className="num mt-1 break-words text-xl font-semibold text-expense sm:text-2xl">
            {money(monthlyOut)}
          </p>
        </Card>
      </div>
      {rows.length === 0 ? (
        <Empty
          text={t("Belum ada transaksi berulang. Tambahkan gaji, sewa, atau transfer tabungan…")}
        />
      ) : (
        <Card className="divide-y">
          {page.visible.map((r) => {
            const left = diffDays(today, r.next_due);
            const every =
              r.interval > 1
                ? `${t("Tiap")} ${r.interval} ${t(CYCLE_UNIT[r.cycle])}`
                : t(CYCLE_LABEL[r.cycle]);
            const route =
              r.kind === "transfer"
                ? `${accName(r.account_id) ?? "—"} → ${accName(r.to_account_id) ?? "—"}`
                : [accName(r.account_id), catName(r.category_id)].filter(Boolean).join(" · ");
            return (
              <div
                key={r.id}
                className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${r.active ? "" : "opacity-60"}`}
              >
                <div className="min-w-0">
                  <p className="min-w-0 truncate font-medium">{r.name}</p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                    <Badge variant="outline">{t(KIND_LABEL[r.kind])}</Badge>
                    <Badge variant="outline">{every}</Badge>
                    {r.auto_post ? (
                      <Badge variant="secondary">{t("Otomatis")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("Manual")}</Badge>
                    )}
                    {r.active ? null : <Badge variant="outline">{t("Dijeda")}</Badge>}
                  </div>
                </div>
                <div className="min-w-0 text-right sm:row-span-2 sm:self-center">
                  <p
                    className={`num break-words font-semibold ${r.kind === "income" ? "text-income" : r.kind === "expense" ? "text-expense" : ""}`}
                  >
                    {money(r.amount, r.currency)}
                  </p>
                  {r.currency === "USD" ? (
                    <p className="num break-words text-xs text-muted-foreground">
                      ≈ {money(Number(r.amount) * usdIdr)}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-2 min-w-0 border-t pt-2 text-xs sm:col-span-1 sm:col-start-1 sm:row-start-2 sm:border-0 sm:pt-0">
                  {r.active ? (
                    <p
                      className={
                        left < 0
                          ? "text-expense"
                          : left <= 3
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {t("Berikutnya")} {dateLabel(r.next_due, locale)}{" "}
                      {left < 0
                        ? `(${t("terlambat")} ${-left} ${t("hari")})`
                        : left === 0
                          ? `(${t("hari ini")})`
                          : `(${left} ${t("hari lagi")})`}
                    </p>
                  ) : null}
                  {route ? <p className="truncate text-muted-foreground">{route}</p> : null}
                  {r.end_date ? (
                    <p className="text-muted-foreground">
                      {t("Berakhir")} {dateLabel(r.end_date, locale)}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1">
                  {r.active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-auto sm:mr-0"
                      disabled={busy === r.id}
                      onClick={() => doPost(r)}
                    >
                      <CheckCircle2 className="size-4" /> {t("Catat sekarang")}
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={r.active ? t("Jeda") : t("Lanjutkan")}
                    title={r.active ? t("Jeda") : t("Lanjutkan")}
                    disabled={busy === r.id}
                    onClick={() => doToggle(r)}
                  >
                    {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <RowActions
                    onEdit={() => crud.openEdit({ ...r })}
                    onDelete={() => crud.remove(r.id, r.name)}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <Pagination
        offset={page.offset}
        pageSize={page.pageSize}
        total={page.total}
        visible={page.visible.length}
        onChange={page.setOffset}
      />
      {crud.dialog(t("transaksi berulang"), (v) => {
        const kind = String(v["kind"] ?? "expense");
        return [
          {
            name: "name",
            label: t("Nama"),
            type: "text",
            placeholder: t("Gaji, Sewa kos, Tabungan bulanan…"),
          },
          {
            name: "kind",
            label: t("Jenis"),
            type: "select",
            half: true,
            options: [
              { value: "income", label: t("Pemasukan") },
              { value: "expense", label: t("Pengeluaran") },
              { value: "transfer", label: t("Transfer") },
            ],
          },
          { name: "amount", label: t("Jumlah"), type: "number", half: true },
          {
            name: "currency",
            label: t("Mata uang"),
            type: "select",
            half: true,
            options: CURRENCY_OPTIONS,
          },
          {
            name: "account_id",
            label: kind === "transfer" ? t("Dari akun") : t("Akun"),
            type: "select",
            half: true,
            options: accOptions,
          },
          ...(kind === "transfer"
            ? [
                {
                  name: "to_account_id",
                  label: t("Ke akun"),
                  type: "select" as const,
                  half: true,
                  options: accOptions,
                },
              ]
            : [
                {
                  name: "category_id",
                  label: t("Kategori"),
                  type: "select" as const,
                  half: true,
                  options: [
                    { value: "", label: "—" },
                    ...categories
                      .filter((c) => c.kind === kind)
                      .map((c) => ({ value: c.id, label: c.name })),
                  ],
                },
              ]),
          {
            name: "cycle",
            label: t("Siklus"),
            type: "select",
            half: true,
            options: [
              { value: "weekly", label: t("Mingguan") },
              { value: "monthly", label: t("Bulanan") },
              { value: "yearly", label: t("Tahunan") },
            ],
          },
          { name: "interval", label: t("Setiap (interval)"), type: "number", half: true },
          ...(v["cycle"] === "weekly"
            ? []
            : [
                {
                  name: "day_of_month",
                  label: t("Tanggal (1–31, opsional)"),
                  type: "number" as const,
                  half: true,
                  placeholder: "25",
                },
              ]),
          { name: "start_date", label: t("Mulai"), type: "date", half: true },
          {
            name: "next_due",
            label: t("Jatuh tempo berikutnya (kosong = otomatis)"),
            type: "date",
            half: true,
          },
          { name: "end_date", label: t("Berakhir (opsional)"), type: "date", half: true },
          { name: "description", label: t("Deskripsi"), type: "text" },
          { name: "merchant", label: t("Merchant / pihak"), type: "text" },
          { name: "auto_post", label: t("Catat otomatis saat jatuh tempo"), type: "switch" },
          { name: "active", label: t("Aktif"), type: "switch" },
        ];
      })}
    </>
  );
}
