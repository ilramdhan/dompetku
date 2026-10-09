import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { CURRENCY_OPTIONS, EntityDialog, type FieldDef } from "./entity-dialog";
import { Button } from "@/components/ui/button";
import { errMsg, rowsQuery, invalidateFor } from "@/lib/queries";
import { saveTransaction, uploadReceiptImage } from "@/lib/finance.functions";
import { todayStr } from "@/lib/dates";
import { useIsDemo } from "@/components/demo";
import { money } from "@/lib/format";
import { feeOptions } from "@/lib/fees";
import { useI18n } from "@/lib/i18n";
import { saveSplitTransaction } from "@/lib/split.functions";
import { validateSplit, type SplitRow } from "@/lib/split";
import { SplitEditor, SPLIT_ON, SPLIT_ROWS } from "./split-editor";
import { useReceiptUrls } from "./receipt-gallery";
import { MAX_RECEIPTS, receiptPaths } from "@/lib/receipts";
import type { Account, Category } from "@/lib/schemas";
import { useAccess } from "@/hooks/use-access";

export type TxDraft = Record<string, unknown>;

export function newTxDraft(kind: "income" | "expense" | "transfer" = "expense"): TxDraft {
  return { kind, currency: "IDR", occurred_at: todayStr(), source: "web", items: null };
}

export function TransactionDialog({
  open,
  onOpenChange,
  initial,
  id,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: TxDraft;
  id?: string | null;
}) {
  const { t } = useI18n();
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const categories = (useQuery(rowsQuery("categories")).data ?? []) as Category[];
  const save = useServerFn(saveTransaction);
  const saveSplit = useServerFn(saveSplitTransaction);
  const qc = useQueryClient();
  // v18 members: only wallets they may manage, and every transaction needs one (server-enforced).
  const { isAdmin, can } = useAccess();
  const accOpts = [
    ...(isAdmin ? [{ value: "", label: t("— Tanpa akun —") }] : []),
    ...accounts
      .filter((a) => !a.archived && can("wallet:manage", a.id))
      .map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
  ];

  const fields = (v: Record<string, unknown>): FieldDef[] => [
    {
      name: "kind",
      label: t("Jenis"),
      type: "select",
      half: true,
      options: [
        { value: "expense", label: t("Pengeluaran") },
        { value: "income", label: t("Pemasukan") },
        { value: "transfer", label: t("Transfer antar akun") },
      ],
    },
    { name: "occurred_at", label: t("Tanggal"), type: "date", half: true },
    { name: "amount", label: t("Jumlah"), type: "number", half: true, placeholder: "50000" },
    {
      name: "currency",
      label: t("Mata uang"),
      type: "select",
      half: true,
      options: CURRENCY_OPTIONS,
    },
    {
      name: "account_id",
      label: v["kind"] === "transfer" ? t("Dari akun") : t("Akun / dompet"),
      type: "select",
      half: true,
      options: accOpts,
    },
    v["kind"] === "transfer"
      ? { name: "to_account_id", label: t("Ke akun"), type: "select", half: true, options: accOpts }
      : {
          name: "category_id",
          label: t("Kategori"),
          type: "select",
          half: true,
          options: [
            { value: "", label: t("— Tanpa kategori —") },
            ...categories
              .filter((c) => c.kind === v["kind"])
              .map((c) => ({ value: c.id, label: c.name })),
          ],
        },
    ...(!id && v["kind"] !== "income"
      ? [
          {
            name: "fee",
            label:
              v["kind"] === "transfer"
                ? t("Biaya transfer / admin (opsional)")
                : t("Biaya admin (opsional)"),
            type: "number" as const,
            half: true,
            placeholder: "2500",
          },
        ]
      : []),
    {
      name: "description",
      label: t("Deskripsi"),
      type: "text",
      placeholder: "Makan siang, gaji Oktober…",
    },
    { name: "merchant", label: t("Merchant / sumber"), type: "text", half: true },
    { name: "notes", label: t("Catatan"), type: "text", half: true },
  ];

  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={id ? t("Ubah transaksi") : t("Catat transaksi")}
      fields={(v) =>
        splitting(v, id) ? fields(v).filter((f) => f.name !== "category_id") : fields(v)
      }
      initial={initial}
      onSubmit={async (v) => {
        const { [SPLIT_ON]: _on, [SPLIT_ROWS]: rows, ...values } = v;
        if (splitting(v, id)) {
          const list = (rows as SplitRow[] | undefined) ?? [];
          const err = validateSplit(values["amount"] as number, list);
          if (err) throw new Error(t(err));
          await saveSplit({
            data: {
              values: { ...values, category_id: null } as never,
              rows: list.map((r) => ({
                category_id: r.category_id!,
                amount: Number(r.amount),
                note: r.note?.trim() || null,
              })),
            },
          });
        } else {
          notifyBudgetAlerts(await save({ data: { id: id ?? null, values: values as never } }), t);
        }
        await invalidateFor(qc, "transactions");
      }}
      extra={(v, set) => (
        <div className="space-y-3">
          {!id && v["kind"] === "transfer"
            ? (() => {
                const opts = feeOptions(
                  accounts.find((a) => a.id === v["account_id"]) as never,
                  accounts.find((a) => a.id === v["to_account_id"]) as never,
                );
                return opts.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-xs text-muted-foreground">
                      {t("Preset biaya:")}
                    </span>
                    {opts.map((o, i) => (
                      <Button
                        key={i}
                        type="button"
                        size="sm"
                        variant={Number(v["fee"]) === o.amount ? "secondary" : "outline"}
                        onClick={() => set("fee", o.amount)}
                        className="h-8 max-w-full rounded-full px-2.5 text-xs"
                      >
                        {o.label} ·{" "}
                        {money(o.amount, String(v["currency"] ?? "IDR"), { reveal: true })}
                      </Button>
                    ))}
                    {Number(v["fee"]) > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => set("fee", "")}
                        className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
                      >
                        {t("Tanpa biaya")}
                      </Button>
                    ) : null}
                  </div>
                ) : null;
              })()
            : null}
          {!id && v["kind"] === "expense" ? (
            <SplitEditor values={v} set={set} categories={categories} />
          ) : null}
          {(v["items"] as { name: string; qty?: number | null; price?: number | null }[] | null)
            ?.length ? (
            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              <p className="mb-2 font-medium">{t("Rincian item dari nota")}</p>
              <ul className="space-y-1">
                {(v["items"] as { name: string; qty?: number | null; price?: number | null }[]).map(
                  (it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {it.qty ? `${it.qty}× ` : ""}
                        {it.name}
                      </span>
                      <span className="num shrink-0 text-muted-foreground">
                        {it.price != null
                          ? money(it.price, String(v["currency"] ?? "IDR"), { reveal: true })
                          : ""}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ) : null}
          <ReceiptField
            paths={receiptPaths(v as never)}
            onChange={(p) => {
              set("receipt_paths", p);
              set("receipt_path", p[0] ?? null);
            }}
          />
        </div>
      )}
    />
  );
}

function ReceiptField({ paths, onChange }: { paths: string[]; onChange: (p: string[]) => void }) {
  const { t } = useI18n();
  const upload = useServerFn(uploadReceiptImage);
  const demo = useIsDemo();
  const [busy, setBusy] = useState(false);
  const urls = useReceiptUrls(paths);
  // Demo mode: photo upload is disabled server-side, so hide the picker too.
  const full = paths.length >= MAX_RECEIPTS || demo;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, MAX_RECEIPTS - paths.length);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of files) {
        if (file.size > 5_000_000) {
          toast.error(t("Gambar maksimal 5 MB"), { description: file.name });
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error(t("Gagal membaca file")));
          r.readAsDataURL(file);
        });
        const { path } = await upload({ data: { image: dataUrl } });
        added.push(path);
      }
      if (added.length) toast.success(t("Foto nota terlampir"));
    } catch (err) {
      toast.error(t("Gagal mengunggah nota"), { description: errMsg(err) });
    } finally {
      if (added.length) onChange([...paths, ...added]);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-muted/50 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <Paperclip className="size-3.5" /> {t("Foto nota")}
          {paths.length ? (
            <span className="text-xs font-normal text-muted-foreground">
              {paths.length}/{MAX_RECEIPTS}
            </span>
          ) : null}
        </p>
        {full ? null : (
          <label className="cursor-pointer py-1.5 text-xs text-primary hover:underline">
            {busy ? t("Mengunggah…") : paths.length ? t("Tambah foto") : t("Unggah")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={busy}
              onChange={pick}
            />
          </label>
        )}
      </div>
      {paths.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {paths.map((p, i) => (
            <li
              key={p}
              className="relative size-16 overflow-hidden rounded-md border bg-background"
            >
              {urls[p] ? (
                <img
                  src={urls[p]}
                  alt={`${t("Foto nota")} ${i + 1}`}
                  className="size-full object-cover"
                />
              ) : null}
              <button
                type="button"
                aria-label={t("Hapus")}
                onClick={() => onChange(paths.filter((x) => x !== p))}
                className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-expense shadow"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("Opsional. Hingga 5 foto JPEG/PNG/WebP, maks 5 MB per foto.")}
        </p>
      )}
    </div>
  );
}

/** Split mode only applies to new expenses. */
function splitting(v: Record<string, unknown>, id: string | null | undefined) {
  return !id && v["kind"] === "expense" && !!v[SPLIT_ON];
}

type BudgetAlertToast = {
  category: string;
  level: number;
  percent: number;
  spent: number;
  effective: number;
};

/** v11: one warning toast per budget threshold crossed by the saved expense (additive, no-op if none). */
function notifyBudgetAlerts(res: unknown, t: (s: string) => string) {
  const list = (res as { budgetAlerts?: BudgetAlertToast[] } | null)?.budgetAlerts ?? [];
  for (const a of list)
    toast.warning(a.level === 100 ? t("Budget terlampaui") : t("Budget hampir habis"), {
      description: `${a.category} · ${Math.round(a.percent)}% · ${money(a.spent)} / ${money(a.effective)}`,
    });
}
