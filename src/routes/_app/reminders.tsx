import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, PiggyBank, Repeat2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { Empty } from "@/components/crud-page";
import { Pagination } from "@/components/pagination";
import { useClientPage } from "@/hooks/use-client-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errMsg, remindersQuery, invalidateFor } from "@/lib/queries";
import { payDebt, paySubscription } from "@/lib/finance.functions";
import { postRecurring } from "@/lib/recurring.functions";
import { dateLabel } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";

export const Route = createFileRoute("/_app/reminders")({
  head: () =>
    pageHead("Pengingat", "Daftar cicilan, langganan, dan budget yang perlu diperhatikan."),
  loader: ({ context }) => context.queryClient.ensureQueryData(remindersQuery(30)),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: RemindersPage,
});

/** Single-column row list. */
const PAGE_SIZE = 20;

function RemindersPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const [days, setDays] = useState(30);
  const { data: list } = useSuspenseQuery(remindersQuery(days));
  const pd = useServerFn(payDebt);
  const ps = useServerFn(paySubscription);
  const pr = useServerFn(postRecurring);
  const qc = useQueryClient();
  // Back to page 1 whenever the period tab changes.
  const page = useClientPage(list, PAGE_SIZE, days);
  const total = list.filter((r) => r.type !== "budget").reduce((a, r) => a + r.amount_idr, 0);

  async function pay(r: (typeof list)[number]) {
    try {
      if (r.type === "recurring") {
        await pr({ data: { id: r.id } });
        await invalidateFor(qc, "recurring_transactions");
        toast.success(t("Tercatat"));
        return;
      }
      if (r.type === "debt") await pd({ data: { debt_id: r.id } });
      else await ps({ data: { id: r.id } });
      await Promise.all([invalidateFor(qc, "debt_payments"), invalidateFor(qc, "subscriptions")]);
      toast.success(t("Pembayaran tercatat"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <>
      <PageHeader
        title={t("Pengingat")}
        subtitle={`${t("Total tagihan:")} ${money(total)}`}
        actions={
          <Tabs
            className="w-full sm:w-auto"
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="7">7 {t("hari")}</TabsTrigger>
              <TabsTrigger value="30">30 {t("hari")}</TabsTrigger>
              <TabsTrigger value="90">90 {t("hari")}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {t("Pengingat juga bisa dikirim otomatis ke Telegram/WhatsApp/email lewat n8n — lihat ")}
        <Link to="/settings" className="text-primary underline">
          {t("Pengaturan")}
        </Link>
        .
      </p>
      {list.length === 0 ? (
        <Empty text={t("Aman! Tidak ada tagihan dalam periode ini.")} />
      ) : (
        <Card className="divide-y">
          {page.visible.map((r) => (
            <div
              key={r.type + r.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${r.overdue ? "bg-destructive/10 text-expense" : "bg-secondary text-secondary-foreground"}`}
              >
                {r.type === "budget" ? (
                  <PiggyBank className="size-4" />
                ) : r.type === "recurring" && !r.overdue ? (
                  <Repeat2 className="size-4" />
                ) : r.overdue ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <CalendarClock className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className={`text-xs ${r.overdue ? "text-expense" : "text-muted-foreground"}`}>
                  {r.type === "budget"
                    ? t("Peringatan budget bulan ini")
                    : `${dateLabel(r.due_date, locale)} · ${r.overdue ? `${t("terlambat")} ${-r.days_left} ${t("hari")}` : r.days_left === 0 ? t("hari ini") : `${r.days_left} ${t("hari lagi")}`}`}
                </p>
              </div>
              <p className="num shrink-0 text-right font-semibold">{money(r.amount, r.currency)}</p>
              {r.type === "recurring" ? (
                <Button
                  className="col-start-2 col-end-4 justify-self-end"
                  size="sm"
                  variant="outline"
                  onClick={() => pay(r)}
                >
                  <CheckCircle2 className="size-4" /> {t("Catat")}
                </Button>
              ) : r.type === "debt" || r.type === "subscription" ? (
                <Button
                  className="col-start-2 col-end-4 justify-self-end"
                  size="sm"
                  variant="outline"
                  onClick={() => pay(r)}
                >
                  <CheckCircle2 className="size-4" /> {t("Bayar")}
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
      <Pagination
        offset={page.offset}
        pageSize={page.pageSize}
        total={page.total}
        visible={page.visible.length}
        onChange={page.setOffset}
      />
    </>
  );
}
