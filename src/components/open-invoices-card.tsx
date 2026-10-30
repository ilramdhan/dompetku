import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { openInvoicesQuery } from "@/lib/queries";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

/** Dashboard card (admin only, #98): open invoices count + outstanding. Hidden before schema v21. */
export function OpenInvoicesCard() {
  usePrivacy();
  const { t } = useI18n();
  const { data } = useQuery(openInvoicesQuery());
  if (!data || !data.ready || data.open === 0) return null;
  return (
    <Link to="/invoices/report" className="mt-4 block min-w-0">
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="size-3.5" />
            {t("Invoice belum lunas")}
          </p>
          <p className="num mt-1 break-words text-xl font-semibold">{money(data.outstanding)}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.open} {t("invoice")}
          {data.overdue ? (
            <span className="text-expense">
              {" · "}
              {data.overdue} {t("lewat jatuh tempo")}
            </span>
          ) : null}
        </p>
      </Card>
    </Link>
  );
}
