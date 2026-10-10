import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileUp } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { SortButton, type SortDirection } from "@/components/sort-button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { buildPreview, parseCsv, type PreviewRow } from "@/lib/csv";
import { importCsvTransactions } from "@/lib/finance.functions";
import { errMsg, rowsQuery, invalidateFor } from "@/lib/queries";
import { dateLabel } from "@/lib/dates";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Account, Category } from "@/lib/schemas";

const TEMPLATE =
  "tanggal,jenis,jumlah,kategori,akun,catatan,mata uang\n2026-10-01,keluar,25000,Makanan & Minuman,GoPay,Kopi pagi,IDR\n2026-10-01,masuk,10000000,Gaji,BCA,Gaji Oktober,IDR\n";

export function CsvImport() {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<"line" | "date" | "kind" | "amount" | "category" | "account">(
    "line",
  );
  const [direction, setDirection] = useState<SortDirection>("asc");
  const categoriesData = useQuery(rowsQuery("categories")).data;
  const accountsData = useQuery(rowsQuery("accounts")).data;
  const categories = useMemo(() => (categoriesData ?? []) as Category[], [categoriesData]);
  const accounts = useMemo(() => (accountsData ?? []) as Account[], [accountsData]);
  const run = useServerFn(importCsvTransactions);
  const qc = useQueryClient();

  const valid = useMemo(() => (rows ?? []).filter((r) => r.value && !r.duplicate), [rows]);
  const dupCount = useMemo(() => (rows ?? []).filter((r) => r.duplicate).length, [rows]);
  const missing = useMemo(() => {
    const cats = new Set<string>();
    const accs = new Set<string>();
    for (const r of valid) {
      const v = r.value!;
      if (
        v.category &&
        !categories.some(
          (c) => c.kind === v.kind && c.name.toLowerCase() === v.category!.toLowerCase(),
        )
      )
        cats.add(`${v.category} (${v.kind === "income" ? t("Pemasukan") : t("Pengeluaran")})`);
      if (v.account && !accounts.some((a) => a.name.toLowerCase() === v.account!.toLowerCase()))
        accs.add(v.account);
    }
    return { cats: [...cats], accs: [...accs] };
  }, [valid, categories, accounts, t]);

  async function onFile(f: File) {
    if (f.size > 5 * 1024 * 1024) {
      toast.error(t("File maksimal 5 MB"));
      return;
    }
    const { rows: r, missingHeaders } = buildPreview(parseCsv(await f.text()));
    if (missingHeaders.length) {
      toast.error(t("Kolom wajib tidak ada: ") + missingHeaders.join(", "));
      return;
    }
    setFileName(f.name);
    setRows(r);
    setCreateMissing(false);
  }

  async function save() {
    const needsConfirm = missing.cats.length + missing.accs.length > 0;
    setBusy(true);
    try {
      const res = await run({
        data: {
          rows: valid.map((r) => r.value!),
          createMissing: needsConfirm ? createMissing : false,
        },
      });
      await invalidateFor(qc, "transactions");
      const parts = [
        `${res.createdCategories + res.createdAccounts ? `${res.createdCategories} ${t("kategori")} & ${res.createdAccounts} ${t("akun baru dibuat")}` : ""}${dupCount ? `${dupCount} ${t("Duplikat")} ${t("dilewati")}` : ""}`.trim(),
      ];
      toast.success(`${res.inserted} ${t("transaksi diimpor")}`, {
        description: parts.filter(Boolean).join(" · ") || undefined,
      });
      setRows(null);
    } catch (e) {
      toast.error(t("Impor gagal"), { description: errMsg(e) });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + TEMPLATE], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-impor-dompetku.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const invalid = (rows ?? []).length - valid.length - dupCount;
  const totalValid = valid.length + dupCount;
  const sortedRows = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) => {
        const av =
          sort === "line"
            ? a.line
            : sort === "date"
              ? (a.value?.date ?? "")
              : sort === "kind"
                ? (a.value?.kind ?? "")
                : sort === "amount"
                  ? (a.value?.amount ?? -1)
                  : sort === "category"
                    ? (a.value?.category ?? "")
                    : (a.value?.account ?? "");
        const bv =
          sort === "line"
            ? b.line
            : sort === "date"
              ? (b.value?.date ?? "")
              : sort === "kind"
                ? (b.value?.kind ?? "")
                : sort === "amount"
                  ? (b.value?.amount ?? -1)
                  : sort === "category"
                    ? (b.value?.category ?? "")
                    : (b.value?.account ?? "");
        return (
          (typeof av === "number" ? av - Number(bv) : String(av).localeCompare(String(bv))) *
          (direction === "asc" ? 1 : -1)
        );
      }),
    [rows, sort, direction],
  );
  const sortBy = (column: typeof sort) => {
    setDirection((d) => (sort === column ? (d === "asc" ? "desc" : "asc") : "asc"));
    setSort(column);
  };
  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-lg font-semibold">{t("Impor CSV transaksi")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Kolom: tanggal, jenis (masuk/keluar), jumlah, kategori, akun, catatan, mata uang. Pemisah koma atau titik koma.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            {t("Unduh template")}
          </Button>
          <input
            ref={ref}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
            <FileUp className="size-4" /> {t("Pilih file")}
          </Button>
        </div>
      </div>

      {rows ? (
        <div className="mt-4 space-y-3">
          <p className="break-words text-sm">
            <span className="font-medium">{fileName}</span> —{" "}
            <span className="text-income">
              {totalValid} {t("valid")}
            </span>
            {invalid ? (
              <>
                ,{" "}
                <span className="text-expense">
                  {invalid} {t(" bermasalah (dilewati)")}
                </span>
              </>
            ) : null}
            {dupCount ? (
              <>
                ,{" "}
                <span className="text-warning">
                  {dupCount} {t("Duplikat")}
                </span>
              </>
            ) : null}
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Baris")}
                      active={sort === "line"}
                      direction={direction}
                      onClick={() => sortBy("line")}
                    />
                  </th>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Tanggal")}
                      active={sort === "date"}
                      direction={direction}
                      onClick={() => sortBy("date")}
                    />
                  </th>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Jenis")}
                      active={sort === "kind"}
                      direction={direction}
                      onClick={() => sortBy("kind")}
                    />
                  </th>
                  <th className="px-3 py-1 text-right">
                    <SortButton
                      label={t("Jumlah")}
                      active={sort === "amount"}
                      direction={direction}
                      onClick={() => sortBy("amount")}
                    />
                  </th>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Kategori")}
                      active={sort === "category"}
                      direction={direction}
                      onClick={() => sortBy("category")}
                    />
                  </th>
                  <th className="px-3 py-1">
                    <SortButton
                      label={t("Akun")}
                      active={sort === "account"}
                      direction={direction}
                      onClick={() => sortBy("account")}
                    />
                  </th>
                  <th className="px-3 py-2">{t("Catatan / Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedRows.map((r) => (
                  <tr
                    key={r.line}
                    className={r.value ? (r.duplicate ? "bg-warning/10" : "") : "bg-destructive/10"}
                  >
                    <td className="num px-3 py-1.5 text-xs text-muted-foreground">{r.line}</td>
                    {r.value ? (
                      <>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {dateLabel(r.value.date, locale)}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.value.kind === "income" ? t("Masuk") : t("Keluar")}
                        </td>
                        <td
                          className={`num whitespace-nowrap px-3 py-1.5 text-right ${r.value.kind === "income" ? "text-income" : "text-expense"}`}
                        >
                          {money(r.value.amount, r.value.currency, { reveal: true })}
                        </td>
                        <td className="px-3 py-1.5">{r.value.category ?? "—"}</td>
                        <td className="px-3 py-1.5">{r.value.account ?? "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {r.value.notes ?? ""}
                          {r.duplicate ? (
                            <span className="ml-2 font-medium text-warning">⚠ {t("Duplikat")}</span>
                          ) : null}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-3 py-1.5 text-destructive">
                        {r.errors.join(", ")}{" "}
                        <span className="text-muted-foreground">({r.raw.join(" | ")})</span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dupCount ? (
            <p className="text-xs text-muted-foreground">
              ⚠ {t("Duplikat")}: {t("sama dengan data yang sudah ada")} — {t("dilewati")}.
            </p>
          ) : null}
          {missing.cats.length + missing.accs.length > 0 ? (
            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              <p className="font-medium">{t("Belum ada di aplikasi:")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missing.cats.map((c) => (
                  <Badge key={c} variant="secondary">
                    {t("Kategori: ")}
                    {c}
                  </Badge>
                ))}
                {missing.accs.map((a) => (
                  <Badge key={a} variant="outline">
                    {t("Akun: ")}
                    {a}
                  </Badge>
                ))}
              </div>
              <label className="mt-3 flex items-start gap-2">
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={createMissing}
                  onCheckedChange={(c) => setCreateMissing(c === true)}
                />
                {t(
                  "Buat kategori & akun baru ini (jika tidak dicentang, transaksi disimpan tanpa kategori/akun tersebut)",
                )}
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setRows(null)}>
              {t("Batal")}
            </Button>
            <Button disabled={busy || totalValid === 0} onClick={save}>
              {busy ? t("Menyimpan…") : `${t("Simpan ")}${totalValid} ${t("transaksi")}`}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
