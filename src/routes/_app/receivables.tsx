import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, HandCoins, Plus, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { CURRENCY_OPTIONS, EntityDialog } from "@/components/entity-dialog";
import { Empty, RowActions } from "@/components/crud-page";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { errMsg, invalidateFor, receivablesQuery, rowsQuery } from "@/lib/queries";
import { payReceivableFn, receivableActionFn, saveReceivableFn } from "@/lib/finance.functions";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account } from "@/lib/schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const Route = createFileRoute("/_app/receivables")({
  head: () =>
    pageHead("Piutang", "Catat uang yang dipinjam kerabat, terima cicilan, dan pantau sisanya."),
  loader: ({ context }) => context.queryClient.ensureQueryData(receivablesQuery()),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: ReceivablesPage,
});

type Values = Record<string, unknown>;

function ReceivablesPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [offset, setOffset] = useState(0);
  const pageSize = 24;
  const data = useSuspenseQuery(receivablesQuery(offset, pageSize)).data as any;
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const save = useServerFn(saveReceivableFn);
  const pay = useServerFn(payReceivableFn);
  const act = useServerFn(receivableActionFn);
  const qc = useQueryClient();
  const ask = useConfirm();
  const [edit, setEdit] = useState<{ open: boolean; id: string | null; initial: Values }>({
    open: false,
    id: null,
    initial: {},
  });
  const [payDlg, setPayDlg] = useState<{ open: boolean; rec: any | null; initial: Values }>({
    open: false,
    rec: null,
    initial: {},
  });
  const refresh = () => invalidateFor(qc, "receivables");
  const accOptions = [
    { value: "", label: "—" },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  if (!data.ready) {
    return (
      <>
        <PageHeader title={t("Piutang")} />
        <Empty
          text={t(
            "Tabel piutang belum ada. Jalankan bagian v3 di supabase/schema.sql lewat SQL Editor Supabase.",
          )}
        />
      </>
    );
  }
  const items = data.items as any[];
  const outstanding = Number(data.outstandingIdr ?? 0);

  async function action(
    id: string,
    a: "settle" | "reopen" | "delete" | "delete_payment",
    question: string,
    destructive = false,
  ) {
    if (!(await ask.confirm(question, { confirmLabel: t("Ya, lanjutkan"), destructive }))) return;
    try {
      await act({ data: { id, action: a } });
      await refresh();
      toast.success(t("Tersimpan"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <>
      <PageHeader
        title={t("Piutang")}
        subtitle={`${t("Belum kembali (IDR):")} ${money(outstanding)}`}
        actions={
          <Button
            onClick={() =>
              setEdit({ open: true, id: null, initial: { currency: "IDR", lent_at: todayStr() } })
            }
          >
            <Plus className="size-4" /> {t("Tambah")}
          </Button>
        }
      />
      {items.length === 0 ? (
        <Empty text={t("Belum ada piutang. Catat uang yang dipinjam teman atau keluarga.")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((r) => (
            <Card key={r.id} className="min-w-0 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold">{r.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.borrower ? <Badge variant="outline">{r.borrower}</Badge> : null}
                    {r.status === "paid" ? (
                      <Badge className="bg-income text-primary-foreground">{t("Lunas")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("Aktif")}</Badge>
                    )}
                  </div>
                </div>
                <RowActions
                  onEdit={() =>
                    setEdit({
                      open: true,
                      id: r.id,
                      initial: {
                        name: r.name,
                        borrower: r.borrower,
                        amount: r.amount,
                        currency: r.currency,
                        lent_at: r.lent_at,
                        due_date: r.due_date,
                        account_id: r.account_id,
                        notes: r.notes,
                      },
                    })
                  }
                  onDelete={() => action(r.id, "delete", `${t("Hapus ")}${r.name}${t("?")}`, true)}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 text-sm min-[430px]:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("Dipinjam")}</p>
                  <p className="num break-words font-semibold">{money(r.amount, r.currency)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("Sisa")}</p>
                  <p className="num break-words font-semibold text-expense">
                    {money(r.remaining, r.currency)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("Tenggat")}</p>
                  <p className="truncate font-semibold">
                    {r.due_date ? dateLabel(r.due_date, locale) : "-"}
                  </p>
                </div>
              </div>
              <Progress className="mt-4" value={r.progress} />
              <div className="mt-4 flex flex-wrap gap-2">
                {r.status === "active" ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        setPayDlg({
                          open: true,
                          rec: r,
                          initial: {
                            amount: r.remaining,
                            account_id: r.account_id ?? "",
                            date: todayStr(),
                          },
                        })
                      }
                    >
                      <HandCoins className="size-4" /> {t("Terima pembayaran")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => action(r.id, "settle", t("Tandai piutang ini lunas?"))}
                    >
                      <CheckCircle2 className="size-4" /> {t("Tandai lunas")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => action(r.id, "reopen", t("Buka kembali piutang ini?"))}
                  >
                    <RotateCcw className="size-4" /> {t("Buka kembali")}
                  </Button>
                )}
              </div>
              {r.payments.length ? (
                <ul className="mt-3 divide-y rounded-lg border text-sm">
                  {r.payments.map((p: any) => (
                    <li
                      key={p.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5"
                    >
                      <span className="truncate">{dateLabel(p.paid_at, locale)}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="num">{money(p.amount, r.currency)}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-9 sm:size-7"
                          aria-label={t("Batalkan")}
                          onClick={() =>
                            action(p.id, "delete_payment", t("Batalkan pembayaran ini?"), true)
                          }
                        >
                          <Undo2 className="size-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Pagination
        offset={offset}
        pageSize={pageSize}
        total={Number(data.total ?? items.length)}
        visible={items.length}
        onChange={setOffset}
      />
      <EntityDialog
        open={edit.open}
        onOpenChange={(o) => setEdit((s) => ({ ...s, open: o }))}
        title={edit.id ? t("Ubah piutang") : t("Tambah piutang")}
        description={
          edit.id
            ? undefined
            : t("Jika akun dipilih, pinjaman tercatat sebagai pengeluaran dari akun itu.")
        }
        initial={edit.initial}
        fields={[
          {
            name: "name",
            label: t("Keperluan"),
            type: "text",
            placeholder: "Pinjam untuk biaya sekolah",
          },
          { name: "borrower", label: t("Peminjam"), type: "text", half: true },
          { name: "amount", label: t("Jumlah"), type: "number", half: true },
          {
            name: "currency",
            label: t("Mata uang"),
            type: "select",
            half: true,
            options: CURRENCY_OPTIONS,
          },
          { name: "lent_at", label: t("Tanggal pinjam"), type: "date", half: true },
          { name: "due_date", label: t("Tenggat (opsional)"), type: "date", half: true },
          {
            name: "account_id",
            label: t("Dari akun (opsional)"),
            type: "select",
            half: true,
            options: accOptions,
          },
          { name: "notes", label: t("Catatan"), type: "textarea" },
        ]}
        onSubmit={async (v) => {
          await save({ data: { id: edit.id, values: v } });
          await refresh();
        }}
      />
      <EntityDialog
        open={payDlg.open}
        onOpenChange={(o) => setPayDlg((s) => ({ ...s, open: o }))}
        title={t("Terima pembayaran")}
        description={
          payDlg.rec
            ? `${payDlg.rec.name} · ${t("Sisa")} ${money(payDlg.rec.remaining, payDlg.rec.currency)}`
            : undefined
        }
        initial={payDlg.initial}
        fields={[
          { name: "amount", label: t("Jumlah"), type: "number", half: true },
          { name: "date", label: t("Tanggal"), type: "date", half: true },
          {
            name: "account_id",
            label: t("Masuk ke akun (opsional)"),
            type: "select",
            options: accOptions,
          },
        ]}
        onSubmit={async (v) => {
          const amount = Number(v["amount"]);
          if (!(amount > 0)) throw new Error(t("Jumlah harus lebih dari 0"));
          await pay({
            data: {
              id: payDlg.rec.id,
              amount,
              account_id: (v["account_id"] as string) || null,
              date: (v["date"] as string) || null,
            },
          });
          await refresh();
        }}
      />
      {ask.element}
    </>
  );
}
