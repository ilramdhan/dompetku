import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  MAX_BACKUP_BYTES,
  REPLACE_CONFIRM_WORD,
  chunkRows,
  parseBackup,
  type IdRemap,
  type ParsedBackup,
} from "@/lib/backup";
import { restoreBackup } from "@/lib/backup.functions";
import { errMsg } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";

type Mode = "merge" | "replace";

/** Settings card: pick a backup JSON → validate & preview counts → restore in chunks. */
export function BackupRestore() {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<Mode>("merge");
  const [confirm, setConfirm] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const run = useServerFn(restoreBackup);
  const qc = useQueryClient();

  async function onFile(f: File) {
    if (f.size > MAX_BACKUP_BYTES) {
      toast.error(t("File maksimal 20 MB"));
      return;
    }
    const r = parseBackup(await f.text());
    if (!r.ok) {
      toast.error(t(r.error));
      return;
    }
    setFileName(f.name);
    setBackup(r.backup);
    setMode("merge");
    setConfirm("");
  }

  function reset() {
    setBackup(null);
    setFileName("");
    setConfirm("");
    if (ref.current) ref.current.value = "";
  }

  async function restore() {
    if (!backup) return;
    if (mode === "replace" && confirm.trim() !== REPLACE_CONFIRM_WORD) return;
    setProgress(0);
    try {
      if (mode === "replace")
        await run({ data: { step: "clear", mode: "replace", confirm: REPLACE_CONFIRM_WORD } });
      const remap: IdRemap = {};
      const skipped: string[] = [];
      let done = 0;
      let restored = 0;
      for (const { table, rows } of backup.tables) {
        for (const chunk of chunkRows(rows)) {
          const r = await run({ data: { step: "chunk", mode, table, rows: chunk, remap } });
          if (r.step === "chunk") {
            if (r.ok) {
              restored += r.upserted;
              remap[table] = { ...remap[table], ...r.remapped };
            } else if (!skipped.includes(table)) skipped.push(table);
          }
          done += chunk.length;
          setProgress(Math.round((done / Math.max(backup.total, 1)) * 100));
        }
      }
      const tables = backup.tables.filter((x) => !skipped.includes(x.table)).length;
      await run({ data: { step: "finish", mode, restored, tables, skipped } });
      // A restore can touch every table at once: this is the one place where a blanket
      // invalidation is intended (AGENTS.md otherwise requires invalidateFor per table).
      await qc.invalidateQueries();
      toast.success(`${t("Cadangan dipulihkan")}: ${restored} ${t("baris")}`);
      if (skipped.length)
        toast.warning(`${t("Tabel belum ada di database, dilewati: ")}${skipped.join(", ")}`);
      reset();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;
  const canRestore =
    !!backup && !busy && (mode === "merge" || confirm.trim() === REPLACE_CONFIRM_WORD);

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("Pulihkan dari backup")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Pilih berkas JSON hasil Unduh cadangan. Data dicek dan ditampilkan dulu sebelum dipulihkan.",
            )}
          </p>
        </div>
        <Button
          className="justify-self-start sm:justify-self-end"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          <Upload className="size-4" /> {t("Pilih berkas JSON")}
        </Button>
        <input
          ref={ref}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      {backup ? (
        <div className="mt-4 space-y-4">
          <p className="min-w-0 break-words text-sm">
            <span className="font-medium">{fileName}</span>
            {backup.exportedAt ? (
              <span className="text-muted-foreground">
                {" · "}
                {new Date(backup.exportedAt).toLocaleString(lang === "en" ? "en-US" : "id-ID")}
              </span>
            ) : null}
          </p>
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {backup.tables.map((x) => (
              <li
                key={x.table}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1"
              >
                <code className="truncate text-xs">{x.table}</code>
                <span className="num shrink-0">{x.rows.length}</span>
              </li>
            ))}
          </ul>
          {backup.ignored.length ? (
            <p className="text-xs text-muted-foreground">
              {t("Tidak dipulihkan: ")}
              {backup.ignored.join(", ")}
            </p>
          ) : null}

          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="grid grid-cols-1 gap-2"
          >
            <Label className="flex items-start gap-2 font-normal">
              <RadioGroupItem value="merge" className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium">{t("Gabungkan")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("Data dengan ID sama diperbarui, data lain tetap ada.")}
                </span>
              </span>
            </Label>
            <Label className="flex items-start gap-2 font-normal">
              <RadioGroupItem value="replace" className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium text-expense">{t("Ganti semua")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("Semua data sekarang dihapus dulu, lalu diisi dari berkas ini.")}
                </span>
              </span>
            </Label>
          </RadioGroup>

          {mode === "replace" ? (
            <div className="space-y-1">
              <Label htmlFor="restore-confirm" className="text-sm">
                {t("Ketik ")}
                <code className="rounded bg-muted px-1">{REPLACE_CONFIRM_WORD}</code>
                {t(" untuk konfirmasi")}
              </Label>
              <Input
                id="restore-confirm"
                value={confirm}
                autoComplete="off"
                onChange={(e) => setConfirm(e.target.value)}
                className="max-w-xs"
              />
            </div>
          ) : null}

          {busy ? <Progress value={progress ?? 0} /> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={mode === "replace" ? "destructive" : "default"}
              disabled={!canRestore}
              onClick={restore}
            >
              {busy ? `${t("Memulihkan…")} ${progress}%` : t("Pulihkan")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              {t("Batal")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
