import { Wallet } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

/**
 * Laporan / Rekap tahunan wallet filter (issue #62): "Semua dompet" (default) or one wallet.
 * Same Select pattern as the account filter on Transaksi; the list comes from the server-scoped
 * `rowsQuery("accounts")`, so members only see wallets they can view.
 */
export function WalletFilter({
  value,
  accounts,
  onChange,
  className,
}: {
  value: string | undefined;
  accounts: readonly { id: string; name: string }[];
  onChange: (account: string | undefined) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : v)}>
      <SelectTrigger
        className={`no-print h-9 w-full min-w-0 sm:w-48 ${className ?? ""}`}
        aria-label={t("Filter dompet")}
      >
        <div className="flex min-w-0 items-center gap-2 [&>span]:truncate">
          <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue placeholder={t("Semua dompet")} />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("Semua dompet")}</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
