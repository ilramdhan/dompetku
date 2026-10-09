import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { CURRENCY_OPTIONS } from "@/components/entity-dialog";
import { Empty, RowActions, useCrudDialog } from "@/components/crud-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { balancesQuery, rowsQuery } from "@/lib/queries";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { formatPresets } from "@/lib/fees";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { useAccess } from "@/hooks/use-access";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const Route = createFileRoute("/_app/accounts")({
  head: () => pageHead("Akun", "Kelola rekening bank, e-wallet, kartu kredit, dan uang tunai."),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(balancesQuery()),
      context.queryClient.ensureQueryData(rowsQuery("accounts")),
    ]),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: AccountsPage,
});

function AccountsPage() {
  usePrivacy();
  const { t } = useI18n();
  const { data: balances } = useSuspenseQuery(balancesQuery());
  const rows = useSuspenseQuery(rowsQuery("accounts")).data as any[];
  const crud = useCrudDialog("accounts", {
    type: "bank",
    currency: "IDR",
    initial_balance: 0,
    archived: false,
    color: "#2f7d5b",
  });
  // v18 members: read-only list of their permitted wallets (accounts CRUD is admin-only).
  const { isAdmin } = useAccess();
  const TYPES = [
    { value: "bank", label: t("Bank") },
    { value: "ewallet", label: t("E-wallet") },
    { value: "cash", label: t("Tunai") },
    { value: "credit_card", label: t("Kartu kredit") },
    { value: "investment", label: t("Investasi") },
    { value: "other", label: t("Lainnya") },
  ];
  return (
    <>
      <PageHeader
        title={t("Akun & Dompet")}
        subtitle={t("Saldo dihitung otomatis dari saldo awal + semua transaksi.")}
        actions={
          isAdmin ? (
            <Button onClick={() => crud.openNew()}>
              <Plus className="size-4" /> {t("Akun baru")}
            </Button>
          ) : undefined
        }
      />
      {balances.length === 0 ? (
        <Empty text={t("Belum ada akun. Tambahkan BCA, GoPay, tunai, dll.")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(balances as any[])
            .map((b) => ({ ...(rows.find((r) => r.id === b.id) ?? {}), ...b }))
            .map((a: any) => (
              <Card
                key={a.id}
                className={`relative min-w-0 overflow-hidden p-5 ${a.archived ? "opacity-60" : ""}`}
              >
                <span
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ background: a.color ?? "var(--primary)" }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/accounts/$id"
                      params={{ id: a.id }}
                      className="block truncate font-display text-lg font-semibold hover:underline"
                      title={t("Lihat laporan akun")}
                    >
                      {a.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {TYPES.find((ty) => ty.value === a.type)?.label}
                      </Badge>
                      <Badge variant="outline">{a.currency}</Badge>
                      {a.archived ? <Badge variant="outline">{t("Arsip")}</Badge> : null}
                    </div>
                  </div>
                  {isAdmin ? (
                    <RowActions
                      onEdit={() =>
                        crud.openEdit({
                          id: a.id,
                          name: a.name,
                          type: a.type,
                          currency: a.currency,
                          initial_balance: a.initial_balance,
                          color: a.color,
                          archived: a.archived,
                          transfer_fees: formatPresets(a.transfer_fees),
                          topup_fees: formatPresets(a.topup_fees),
                          monthly_fee: a.monthly_fee,
                          monthly_fee_day: a.monthly_fee_day,
                        })
                      }
                      onDelete={() => crud.remove(a.id, `${t("akun")} ${a.name}`)}
                    />
                  ) : null}
                </div>
                {Number(a.monthly_fee) > 0 ? (
                  <p className="num mt-2 break-words text-xs text-muted-foreground">
                    {t("Biaya bulanan")} {money(a.monthly_fee, a.currency)} · {t("tgl")}{" "}
                    {a.monthly_fee_day ?? 1}
                  </p>
                ) : null}
                <p
                  className={`num mt-4 break-words text-2xl font-semibold ${Number(a.balance) < 0 ? "text-expense" : ""}`}
                >
                  {money(a.balance, a.currency)}
                </p>
              </Card>
            ))}
        </div>
      )}
      {crud.dialog(t("akun"), [
        { name: "name", label: t("Nama"), type: "text", placeholder: "BCA, GoPay, Dompet…" },
        { name: "type", label: t("Jenis"), type: "select", half: true, options: TYPES },
        {
          name: "currency",
          label: t("Mata uang"),
          type: "select",
          half: true,
          options: CURRENCY_OPTIONS,
        },
        { name: "initial_balance", label: t("Saldo awal"), type: "number", half: true },
        { name: "color", label: t("Warna"), type: "color", half: true },
        {
          name: "transfer_fees",
          label: t("Preset biaya transfer keluar (nama=biaya; …)"),
          type: "text",
          placeholder: "BI-FAST=2500; Online=6500",
        },
        {
          name: "topup_fees",
          label: t("Preset biaya admin top-up ke akun ini"),
          type: "text",
          placeholder: "Top-up via BCA=1000; Alfamart=2500",
        },
        {
          name: "monthly_fee",
          label: t("Biaya bulanan otomatis"),
          type: "number",
          half: true,
          placeholder: "15000",
        },
        {
          name: "monthly_fee_day",
          label: t("Tanggal potong (1-31)"),
          type: "number",
          half: true,
          placeholder: "25",
        },
        { name: "archived", label: t("Arsipkan akun"), type: "switch" },
      ])}
    </>
  );
}
