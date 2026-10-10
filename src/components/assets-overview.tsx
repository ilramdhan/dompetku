import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, HandCoins, PiggyBank, TrendingDown, TrendingUp } from "lucide-react";
import { DonutChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { assetsQuery } from "@/lib/queries";
import { money } from "@/lib/format";
import { secret, usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  investment: "var(--chart-2)",
  gold: "var(--chart-3)",
  receivables: "var(--chart-4)",
};

export function AssetsOverview() {
  usePrivacy();
  const { t } = useI18n();
  const { data: a } = useQuery(assetsQuery());
  if (!a) return null;
  const LABEL: Record<string, string> = {
    cash: t("Kas & bank"),
    investment: t("Investasi"),
    gold: t("Emas"),
    receivables: t("Piutang"),
  };
  const g = a.gold as any;
  const ref = g.ready ? (g.antam ?? g.world) : null;
  const goalPct = a.goalsTarget > 0 ? (a.goalsSaved / a.goalsTarget) * 100 : 0;

  return (
    <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-3">
      <Card className="min-w-0 p-5 xl:col-span-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("Aset & Investasi")}</h2>
          <p className="num min-w-0 break-words text-lg font-semibold">{money(a.totalAssets)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            to="/gold"
            className="min-w-0 rounded-xl border p-3 transition-colors hover:bg-muted/50"
          >
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              <Coins className="size-3.5" />
              {t("Emas")}
            </p>
            {g.ready ? (
              <>
                <p className="num mt-1 break-words text-xl font-semibold">
                  {money(ref?.value ?? 0)}
                </p>
                <p className="num break-words text-xs text-muted-foreground">
                  {secret(String(g.grams))} g · {t("modal")} {money(g.cost)}
                </p>
                {ref ? (
                  <p
                    className={`num mt-1 flex items-center gap-1 text-xs font-medium ${ref.pnl >= 0 ? "text-income" : "text-expense"}`}
                  >
                    {ref.pnl >= 0 ? (
                      <TrendingUp className="size-3.5" />
                    ) : (
                      <TrendingDown className="size-3.5" />
                    )}
                    {money(ref.pnl)}
                    {g.cost > 0 ? ` (${((ref.pnl / g.cost) * 100).toFixed(1)}%)` : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Jalankan bagian schema v3 untuk mengaktifkan.")}
              </p>
            )}
          </Link>
          <Link
            to="/receivables"
            className="min-w-0 rounded-xl border p-3 transition-colors hover:bg-muted/50"
          >
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              <HandCoins className="size-3.5" />
              {t("Piutang")}
            </p>
            <p className="num mt-1 break-words text-xl font-semibold">
              {money(a.receivablesOutstanding)}
            </p>
            <p className="text-xs text-muted-foreground">{t("belum dibayar")}</p>
          </Link>
          <Link
            to="/goals"
            className="min-w-0 rounded-xl border p-3 transition-colors hover:bg-muted/50"
          >
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              <PiggyBank className="size-3.5" />
              {t("Target tabungan")}
            </p>
            <p className="num mt-1 break-words text-xl font-semibold">{money(a.goalsSaved)}</p>
            <p className="num text-xs text-muted-foreground">
              {t("dari")} {money(a.goalsTarget)}
            </p>
            <Progress
              className="mt-2"
              value={Math.min(100, goalPct)}
              aria-label={`${t("Target tabungan")} ${Math.round(goalPct)}%`}
            />
          </Link>
        </div>
        {g.ready && (g.world || g.antam) ? (
          <div className="mt-4 rounded-xl bg-muted/50 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t("Harga emas hari ini (per gram)")}
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["world", t("Dunia (XAU)")],
                ["antam", "Antam"],
              ].map(([k, label]) => {
                const p = g[k!];
                return p ? (
                  <div
                    key={k}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-2"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {label}
                      {p.estimated ? <Badge variant="outline">{t("perkiraan")}</Badge> : null}
                    </span>
                    <span className="num min-w-0 break-words text-muted-foreground">
                      {t("jual")} {money(p.buy)} · {t("buyback")} {money(p.buyback)}
                    </span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
      </Card>
      <Card className="min-w-0 p-5">
        <h2 className="mb-2 text-lg font-semibold">{t("Komposisi aset")}</h2>
        {a.composition.length ? (
          <>
            <div className="h-40">
              <DonutChart
                data={a.composition.map((c: any) => ({
                  name: LABEL[c.key]!,
                  value: c.value,
                  color: COLORS[c.key]!,
                }))}
                innerRadius={42}
                outerRadius={70}
              />
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {a.composition.map((c: any) => (
                <li key={c.key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: COLORS[c.key] }} />
                    {LABEL[c.key]}
                  </span>
                  <span className="num text-muted-foreground">
                    {a.totalAssets > 0 ? Math.round((c.value / a.totalAssets) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
            {a.creditCardIdr < 0 ? (
              <p className="num mt-3 text-xs text-muted-foreground">
                {t("Tagihan kartu kredit")} {money(-a.creditCardIdr)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("Belum ada aset tercatat.")}
          </p>
        )}
      </Card>
    </div>
  );
}
