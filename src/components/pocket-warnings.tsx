import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { pocketWarningsQuery } from "@/lib/queries";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Dashboard (v19): Kantong at or below their threshold this month in the caller's wallets.
 * Renders nothing when every pocket is fine (or before schema v19), so it never adds noise.
 */
export function PocketWarnings({ month }: { month: string }) {
  usePrivacy();
  const { t } = useI18n();
  const { data = [] } = useQuery(pocketWarningsQuery(month));
  const list = data as any[];
  if (!list.length) return null;
  return (
    <Card className="mt-4 min-w-0 p-5">
      <h2 className="mb-3 flex min-w-0 items-center gap-2 text-lg font-semibold">
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        <span className="min-w-0 truncate">{t("Kantong perlu perhatian")}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.slice(0, 6).map((p) => (
          <li key={p.id} className="min-w-0 text-sm">
            <Link
              to="/accounts/$id"
              params={{ id: p.account_id }}
              className="mb-1 flex min-w-0 justify-between gap-2 hover:underline"
            >
              <span className="min-w-0 truncate">
                {p.name}
                {p.account ? <span className="text-muted-foreground"> · {p.account}</span> : null}
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${p.level === "empty" ? "text-expense" : "text-warning"}`}
              >
                {p.level === "empty" ? t("Habis") : t("Menipis")}
              </span>
            </Link>
            <Progress value={p.percentLeft} aria-label={`${t("Sisa")} ${p.percentLeft}%`} />
            <p className="num mt-1 text-xs text-muted-foreground">
              {t("Sisa")} {money(p.remaining, p.currency)} / {money(p.allocated, p.currency)}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
