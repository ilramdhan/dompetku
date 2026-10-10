import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Plus } from "lucide-react";
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
import { errMsg, fxQuery, rowsQuery, invalidateFor } from "@/lib/queries";
import { paySubscription } from "@/lib/finance.functions";
import { dateLabel, diffDays, todayStr } from "@/lib/dates";
import { withTax } from "@/lib/fees";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account, Category, Subscription } from "@/lib/schemas";

export const Route = createFileRoute("/_app/subscriptions")({
  head: () => pageHead("Langganan", "Kelola langganan bulanan dan tahunan dalam IDR maupun USD."),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(rowsQuery("subscriptions")),
      context.queryClient.ensureQueryData(fxQuery()),
    ]),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: SubsPage,
});

/** Single-column row list. */
const PAGE_SIZE = 20;

function SubsPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const subs = useSuspenseQuery(rowsQuery("subscriptions")).data as Subscription[];
  const { usdIdr } = useSuspenseQuery(fxQuery()).data;
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const categories = (useQuery(rowsQuery("categories")).data ?? []) as Category[];
  const pay = useServerFn(paySubscription);
  const qc = useQueryClient();
  const crud = useCrudDialog("subscriptions", {
    currency: "IDR",
    cycle: "monthly",
    next_due: todayStr(),
    active: true,
  });
  const toIdr = (s: Subscription) =>
    withTax(Number(s.amount), s.tax_percent) * (s.currency === "USD" ? usdIdr : 1);
  const page = useClientPage(subs, PAGE_SIZE);
  const active = subs.filter((s) => s.active);
  const monthly = active.reduce((a, s) => a + (s.cycle === "yearly" ? toIdr(s) / 12 : toIdr(s)), 0);
  const today = todayStr();
  const accName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name;

  async function doPay(s: Subscription) {
    try {
      const r = await pay({ data: { id: s.id } });
      await Promise.all([invalidateFor(qc, "transactions"), invalidateFor(qc, "subscriptions")]);
      toast.success(`${t("Tercatat. Tagihan berikutnya")} ${dateLabel(r.next_due, locale)}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <>
      <PageHeader
        title={t("Langganan")}
        subtitle={`1 USD = ${money(usdIdr)} (${t("kurs otomatis harian")})`}
        actions={
          <Button onClick={() => crud.openNew()}>
            <Plus className="size-4" /> {t("Langganan")}
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="min-w-0 bg-ink p-5 text-ink-foreground">
          <p className="text-xs uppercase tracking-wider text-ink-muted">
            {t("Per bulan (setara)")}
          </p>
          <p className="num mt-1 break-words text-xl font-semibold sm:text-2xl">{money(monthly)}</p>
        </Card>
        <Card className="min-w-0 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Per tahun (setara)")}
          </p>
          <p className="num mt-1 break-words text-xl font-semibold sm:text-2xl">
            {money(monthly * 12)}
          </p>
        </Card>
      </div>
      {subs.length === 0 ? (
        <Empty text={t("Belum ada langganan. Tambahkan Netflix, Spotify, iCloud, ChatGPT…")} />
      ) : (
        <Card className="divide-y">
          {page.visible.map((s) => {
            const left = diffDays(today, s.next_due);
            return (
              <div
                key={s.id}
                className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${s.active ? "" : "opacity-50"}`}
              >
                <div className="min-w-0">
                  <p className="min-w-0 truncate font-medium">{s.name}</p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                    <Badge variant="outline">
                      {s.cycle === "yearly" ? t("Tahunan") : t("Bulanan")}
                    </Badge>
                    {Number(s.tax_percent) > 0 ? (
                      <Badge variant="secondary" className="num">
                        +{t("pajak")} {s.tax_percent}%
                      </Badge>
                    ) : null}
                    {s.active ? null : <Badge variant="outline">{t("Nonaktif")}</Badge>}
                  </div>
                </div>
                <div className="min-w-0 text-right sm:row-span-2 sm:self-center">
                  <p className="num break-words font-semibold">
                    {money(withTax(Number(s.amount), s.tax_percent), s.currency)}
                  </p>
                  {Number(s.tax_percent) > 0 ? (
                    <p className="num break-words text-xs text-muted-foreground">
                      {money(s.amount, s.currency)} + {s.tax_percent}%
                    </p>
                  ) : null}
                  {s.currency === "USD" ? (
                    <p className="num break-words text-xs text-muted-foreground">
                      ≈ {money(toIdr(s))}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-2 min-w-0 border-t pt-2 sm:col-span-1 sm:col-start-1 sm:row-start-2 sm:border-0 sm:pt-0">
                  <div className="min-w-0 text-xs">
                    <p
                      className={
                        left < 0
                          ? "text-expense"
                          : left <= 3
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {t("Jatuh tempo")} {dateLabel(s.next_due, locale)}{" "}
                      {left < 0
                        ? `(${t("terlambat")} ${-left} ${t("hari")})`
                        : left === 0
                          ? `(${t("hari ini")})`
                          : `(${left} ${t("hari lagi")})`}
                    </p>
                    {accName(s.account_id) ? (
                      <p className="truncate text-muted-foreground">
                        {t("Dibayar dari")} {accName(s.account_id)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1">
                  {s.active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-auto sm:mr-0"
                      onClick={() => doPay(s)}
                    >
                      <CheckCircle2 className="size-4" /> {t("Sudah bayar")}
                    </Button>
                  ) : null}
                  <RowActions
                    onEdit={() => crud.openEdit({ ...s })}
                    onDelete={() => crud.remove(s.id, s.name)}
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
      {crud.dialog(t("langganan"), [
        {
          name: "name",
          label: t("Nama layanan"),
          type: "text",
          placeholder: "Netflix, ChatGPT Plus…",
        },
        {
          name: "amount",
          label: t("Harga (sebelum pajak, atau sudah termasuk)"),
          type: "number",
          half: true,
        },
        {
          name: "tax_percent",
          label: t("Pajak % (opsional, kosongkan jika sudah termasuk)"),
          type: "number",
          half: true,
          placeholder: "11",
        },
        {
          name: "currency",
          label: t("Mata uang"),
          type: "select",
          half: true,
          options: CURRENCY_OPTIONS,
        },
        {
          name: "cycle",
          label: t("Siklus"),
          type: "select",
          half: true,
          options: [
            { value: "monthly", label: t("Bulanan") },
            { value: "yearly", label: t("Tahunan") },
          ],
        },
        { name: "next_due", label: t("Tagihan berikutnya"), type: "date", half: true },
        {
          name: "account_id",
          label: t("Dibayar dari"),
          type: "select",
          half: true,
          options: [
            { value: "", label: "—" },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ],
        },
        {
          name: "category_id",
          label: t("Kategori"),
          type: "select",
          half: true,
          options: [
            { value: "", label: t("Langganan (default)") },
            ...categories
              .filter((c) => c.kind === "expense")
              .map((c) => ({ value: c.id, label: c.name })),
          ],
        },
        { name: "active", label: t("Aktif"), type: "switch" },
        { name: "notes", label: t("Catatan"), type: "textarea" },
      ])}
    </>
  );
}
