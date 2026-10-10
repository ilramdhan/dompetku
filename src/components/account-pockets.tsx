import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { EntityDialog } from "./entity-dialog";
import { useConfirm } from "./confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { accountPocketsQuery, errMsg, invalidateFor } from "@/lib/queries";
import { deletePocketFn, savePocketFn } from "@/lib/pockets.functions";
import { pocketPeriod, type PocketLevel } from "@/lib/pockets";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dlg = { open: boolean; id: string | null; initial: Record<string, unknown> };
const closed: Dlg = { open: false, id: null, initial: {} };

/** Wallet detail "Kantong" card (v19): pockets with progress, unallocated amount and CRUD. */
export function AccountPockets({
  accountId,
  month,
  currency,
  canManage,
}: {
  accountId: string;
  month: string;
  currency: string;
  canManage: boolean;
}) {
  usePrivacy();
  const { t } = useI18n();
  const qc = useQueryClient();
  const ask = useConfirm();
  const save = useServerFn(savePocketFn);
  const del = useServerFn(deletePocketFn);
  const [dlg, setDlg] = useState<Dlg>(closed);
  const { data } = useQuery({
    ...accountPocketsQuery(accountId, month),
    placeholderData: (p) => p,
  });
  if (!data) return null;
  const pockets = (data.pockets ?? []) as any[];
  const active = pockets.filter((p) => !p.archived);
  const archived = pockets.filter((p) => p.archived);
  const u = data.unallocated as { amount: number; earmarked: number; over: boolean } | null;

  const persist = async (values: Record<string, unknown>, id: string | null) => {
    await save({ data: { id, account_id: accountId, values: values as never } });
    await invalidateFor(qc, "pockets");
  };
  const toggleArchive = async (p: any) => {
    try {
      await persist({ ...editable(p), archived: !p.archived }, p.id);
      toast.success(p.archived ? t("Kantong diaktifkan lagi") : t("Kantong diarsipkan"));
    } catch (e) {
      toast.error(t("Gagal menyimpan"), { description: errMsg(e) });
    }
  };
  const remove = async (p: any) => {
    const ok = await ask.confirm(t("Hapus kantong ini?"), {
      description: t("Transaksinya tetap ada, hanya tidak lagi masuk kantong."),
      confirmLabel: t("Hapus"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del({ data: { id: p.id } });
      await invalidateFor(qc, "pockets");
      toast.success(t("Kantong dihapus"));
    } catch (e) {
      toast.error(t("Gagal menghapus"), { description: errMsg(e) });
    }
  };

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-lg font-semibold">{t("Kantong")}</h2>
        {canManage && data.ready ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDlg({
                open: true,
                id: null,
                initial: { period: "monthly", allocated: "", sort_order: active.length },
              })
            }
          >
            <Plus className="size-4" /> {t("Kantong")}
          </Button>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {t(
          "Pisahkan uang di dompet ini untuk tujuan tertentu. Budget per kategori tetap terpisah.",
        )}
      </p>
      {!data.ready ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("Fitur kantong belum aktif: jalankan bagian v19 di supabase/schema.sql.")}
        </p>
      ) : (
        <>
          {u ? (
            <div
              className={`mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${u.over ? "border-expense/40 bg-expense/5" : "bg-muted/40"}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {u.over ? <TriangleAlert className="size-4 shrink-0 text-expense" /> : null}
                <span className="min-w-0">
                  {u.over ? t("Alokasi melebihi saldo dompet") : t("Belum dialokasikan")}
                </span>
              </span>
              <span className={`num shrink-0 font-semibold ${u.over ? "text-expense" : ""}`}>
                {money(u.amount, currency)}
              </span>
            </div>
          ) : null}
          {active.length ? (
            <ul className="space-y-4">
              {active.map((p) => (
                <PocketRow
                  key={p.id}
                  p={p}
                  currency={currency}
                  canManage={canManage}
                  onEdit={() => setDlg({ open: true, id: p.id, initial: editable(p) })}
                  onArchive={() => void toggleArchive(p)}
                  onDelete={() => void remove(p)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Belum ada kantong di dompet ini.")}</p>
          )}
          {archived.length ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t("Kantong arsip")} ({archived.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {archived.map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{p.name}</span>
                    {canManage ? (
                      <span className="flex shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("Aktifkan lagi")}
                          onClick={() => void toggleArchive(p)}
                        >
                          <ArchiveRestore className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("Hapus")}
                          onClick={() => void remove(p)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      {ask.element}
      <EntityDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg((d) => (o ? d : closed))}
        title={dlg.id ? t("Ubah kantong") : t("Kantong baru")}
        description={t("Jumlah memakai mata uang dompet ini.")}
        initial={dlg.initial}
        fields={[
          { name: "name", label: t("Nama kantong"), type: "text", placeholder: t("Makan") },
          {
            name: "allocated",
            label: t("Alokasi"),
            type: "number",
            half: true,
            placeholder: "500000",
          },
          {
            name: "min_balance",
            label: t("Peringatan jika sisa ≤ (opsional)"),
            type: "number",
            half: true,
            placeholder: "50000",
          },
          {
            name: "period",
            label: t("Periode"),
            type: "select",
            half: true,
            options: [
              { value: "monthly", label: t("Bulanan (mulai lagi tiap bulan)") },
              { value: "none", label: t("Berjalan (tanpa reset)") },
            ],
          },
          { name: "color", label: t("Warna"), type: "color", half: true },
        ]}
        onSubmit={async (v) => {
          await persist(
            {
              ...v,
              archived: !!v["archived"],
              sort_order: Number(v["sort_order"]) || 0,
            },
            dlg.id,
          );
        }}
      />
    </Card>
  );
}

function editable(p: any): Record<string, unknown> {
  return {
    name: p.name,
    allocated: p.allocated,
    min_balance: p.min_balance ?? "",
    period: pocketPeriod(p),
    color: p.color ?? undefined,
    icon: p.icon ?? null,
    archived: !!p.archived,
    sort_order: p.sort_order ?? 0,
  };
}

const LEVEL_TONE: Record<PocketLevel, string> = {
  low: "text-warning",
  empty: "text-expense",
};

function PocketRow({
  p,
  currency,
  canManage,
  onEdit,
  onArchive,
  onDelete,
}: {
  p: any;
  currency: string;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const level = p.level as PocketLevel | null;
  return (
    <li className="min-w-0 text-sm">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: p.color ?? "var(--primary)" }}
          />
          <span className="min-w-0 truncate font-medium">{p.name}</span>
          {pocketPeriod(p) === "none" ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {t("Berjalan")}
            </Badge>
          ) : null}
          {level ? (
            <Badge
              variant={level === "empty" ? "destructive" : "secondary"}
              className="shrink-0 text-[10px]"
            >
              {level === "empty" ? t("Habis") : t("Menipis")}
            </Badge>
          ) : null}
        </span>
        {canManage ? (
          <span className="flex shrink-0">
            <Button size="icon" variant="ghost" aria-label={t("Ubah")} onClick={onEdit}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("Arsipkan")} onClick={onArchive}>
              <Archive className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("Hapus")} onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          </span>
        ) : null}
      </div>
      <Progress value={p.percentLeft} aria-label={`${t("Sisa")} ${p.percentLeft}%`} />
      <div className="mt-1 flex min-w-0 flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span className={`num ${level ? LEVEL_TONE[level] : ""}`}>
          {t("Sisa")} {money(p.remaining, currency)} / {money(p.allocated, currency)}
        </span>
        <span className="num">
          {t("Terpakai")} {money(p.spent, currency)}
          {p.added > 0 ? ` · +${money(p.added, currency)}` : ""}
        </span>
      </div>
    </li>
  );
}
