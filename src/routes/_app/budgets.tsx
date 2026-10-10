import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { Empty, RowActions, useCrudDialog } from "@/components/crud-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { budgetsQuery, rowsQuery } from "@/lib/queries";
import { currentMonth, monthLabel } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Category } from "@/lib/schemas";

export const Route = createFileRoute("/_app/budgets")({
  head: () =>
    pageHead("Budget", "Batas pengeluaran bulanan per kategori dengan peringatan otomatis."),
  loader: ({ context }) => context.queryClient.ensureQueryData(budgetsQuery(currentMonth())),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: BudgetsPage,
});

function BudgetsPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const month = currentMonth();
  const { data: budgets } = useSuspenseQuery(budgetsQuery(month));
  const categories = (useQuery(rowsQuery("categories")).data ?? []) as Category[];
  const crud = useCrudDialog("budgets", { alert_percent: 80, rollover: false });
  const total = budgets.reduce((a, b) => a + b.amount, 0);
  const spent = budgets.reduce((a, b) => a + b.spent, 0);
  return (
    <>
      <PageHeader
        title={t("Budget")}
        subtitle={`${t("Bulan")} ${monthLabel(month, lang === "en" ? "en-US" : "id-ID")} · ${t("terpakai")} ${money(spent)} ${t("dari")} ${money(total)}`}
        actions={
          <Button onClick={() => crud.openNew()}>
            <Plus className="size-4" /> {t("Budget")}
          </Button>
        }
      />
      {budgets.length === 0 ? (
        <Empty text={t("Belum ada budget. Contoh: Makanan Rp2.000.000 per bulan.")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {budgets.map((b) => {
            const tone =
              b.percent >= 100
                ? "text-expense"
                : b.percent >= b.alert_percent
                  ? "text-warning"
                  : "text-income";
            return (
              <Card key={b.id} className="min-w-0 p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 flex-1 items-center gap-2 font-display text-lg font-semibold">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: b.color ?? "var(--primary)" }}
                    />
                    <span className="truncate">{b.category}</span>
                  </p>
                  <RowActions
                    onEdit={() =>
                      crud.openEdit({
                        id: b.id,
                        category_id: b.category_id,
                        amount: b.amount,
                        alert_percent: b.alert_percent,
                        rollover: b.rollover,
                      })
                    }
                    onDelete={() => crud.remove(b.id, `${t("budget")} ${b.category}`)}
                  />
                </div>
                <p className="mt-3 break-words text-sm">
                  <span className={`num text-xl font-semibold ${tone}`}>{money(b.spent)}</span>{" "}
                  <span className="text-muted-foreground">/ {money(b.effective)}</span>
                </p>
                {b.rollover ? (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {t("Dibawa dari bulan lalu")}:{" "}
                    <span className={`num ${b.carry < 0 ? "text-expense" : "text-income"}`}>
                      {b.carry >= 0 ? "+" : ""}
                      {money(b.carry)}
                    </span>{" "}
                    · {t("Batas efektif")} {money(b.effective)}
                  </p>
                ) : null}
                <Progress
                  className="mt-3"
                  value={Math.min(100, b.percent)}
                  aria-label={`${b.category} ${Math.round(b.percent)}%`}
                />
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  {b.percent >= 100
                    ? `${t("Lewat")} ${money(b.spent - b.effective)}`
                    : `${t("Sisa")} ${money(b.effective - b.spent)}`}{" "}
                  · {t("peringatan di")} {b.alert_percent}%
                </p>
              </Card>
            );
          })}
        </div>
      )}
      {crud.dialog(t("budget"), [
        {
          name: "category_id",
          label: t("Kategori pengeluaran"),
          type: "select",
          options: categories
            .filter((c) => c.kind === "expense")
            .map((c) => ({ value: c.id, label: c.name })),
        },
        { name: "amount", label: t("Batas per bulan (IDR)"), type: "number", half: true },
        { name: "alert_percent", label: t("Peringatan saat (%)"), type: "number", half: true },
        { name: "rollover", label: t("Sisa bulan lalu dibawa (rollover)"), type: "switch" },
      ])}
    </>
  );
}
