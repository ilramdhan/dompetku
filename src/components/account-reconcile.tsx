import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { CheckCircle2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { TxDraft } from "@/components/transaction-dialog";
import { getAccountBalanceAt, saveAccountReconciliation } from "@/lib/account-report.functions";
import {
  draftFromLine,
  matchStatement,
  parseStatement,
  reconcileDifference,
  signedAmount,
  statementWindow,
  type StatementLine,
} from "@/lib/account-report";
import { parseAmount, parseCsv } from "@/lib/csv";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { errMsg, invalidateFor, reconcileTxQuery } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Last = { as_of: string; statement_balance: number; app_balance: number } | null;

export function AccountReconcile({
  accountId,
  currency,
  ready,
  last,
  onRecord,
}: {
  accountId: string;
  currency: string;
  ready: boolean;
  last: Last;
  onRecord: (draft: TxDraft) => void;
}) {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const qc = useQueryClient();
  const balanceAt = useServerFn(getAccountBalanceAt);
  const save = useServerFn(saveAccountReconciliation);
  const [asOf, setAsOf] = useState(todayStr());
  const [stmt, setStmt] = useState("");
  const [result, setResult] = useState<{ asOf: string; statement: number; app: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  const [badRows, setBadRows] = useState<number[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const win = lines ? statementWindow(lines) : null;
  const { data: txs = [], isFetching } = useQuery({
    ...reconcileTxQuery(accountId, win?.from ?? "", win?.to ?? ""),
    enabled: !!win,
  });
  const match = lines && win ? matchStatement(lines, txs as any[], accountId) : null;

  async function check() {
    const statement = parseAmount(stmt);
    if (statement == null) {
      toast.error(t("Saldo rekening koran tidak valid"));
      return;
    }
    setBusy(true);
    try {
      const app = await balanceAt({ data: { id: accountId, date: asOf } });
      setResult({ asOf, statement, app });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCheckpoint() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await save({
        data: { id: accountId, as_of: result.asOf, statement_balance: result.statement },
      });
      if (r.saved) toast.success(t("Rekonsiliasi disimpan"));
      else toast.info(t("Jalankan skema v13 untuk menyimpan riwayat rekonsiliasi."));
      await invalidateFor(qc, "account_reconciliations");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parseStatement(parseCsv(await file.text()));
      if (parsed.missingHeaders.length) {
        toast.error(`${t("Kolom wajib tidak ada:")} ${parsed.missingHeaders.join(", ")}`);
        return;
      }
      if (!parsed.lines.length) {
        toast.error(t("Tidak ada baris mutasi yang valid."));
        return;
      }
      setLines(parsed.lines);
      setBadRows(parsed.errors);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const diff = result ? reconcileDifference(result.statement, result.app) : 0;

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("Rekonsiliasi")}</h2>
        {last ? (
          <Badge variant="secondary">
            {t("Terakhir direkonsiliasi")} {dateLabel(last.as_of, locale)}
          </Badge>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("Cocokkan saldo aplikasi dengan rekening koran atau mutasi bank.")}
      </p>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="recon-date">{t("Tanggal rekening koran")}</Label>
          <Input
            id="recon-date"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="recon-balance">{t("Saldo akhir rekening koran")}</Label>
          <Input
            id="recon-balance"
            inputMode="decimal"
            placeholder="1.250.000"
            value={stmt}
            onChange={(e) => setStmt(e.target.value)}
          />
        </div>
        <Button disabled={busy || !asOf || !stmt.trim()} onClick={check}>
          {t("Bandingkan")}
        </Button>
      </div>

      {result ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Figure label={t("Saldo aplikasi")} value={money(result.app, currency)} />
          <Figure label={t("Saldo rekening koran")} value={money(result.statement, currency)} />
          <Figure
            label={t("Selisih")}
            value={money(diff, currency)}
            tone={diff === 0 ? "text-income" : "text-expense"}
          />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            {diff === 0 ? (
              <span className="flex items-center gap-1.5 text-sm text-income">
                <CheckCircle2 className="size-4" /> {t("Saldo cocok")}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("Selisih positif berarti bank mencatat lebih banyak dari aplikasi.")}
              </span>
            )}
            {ready ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={saveCheckpoint}>
                {t("Simpan rekonsiliasi")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-muted-foreground">
            {t(
              "Impor CSV mutasi bank (tanggal, keterangan, jumlah ±) untuk mencocokkan transaksi.",
            )}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={pickCsv}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> {t("Impor mutasi")}
          </Button>
        </div>
        {match ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              {match.matched.length} {t("cocok")} · {match.unmatchedLines.length}{" "}
              {t("hanya di bank")} · {match.unmatchedTx.length} {t("hanya di aplikasi")}
              {badRows.length ? ` · ${badRows.length} ${t("baris dilewati")}` : ""}
              {isFetching ? ` · ${t("Memuat…")}` : ""}
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold">{t("Belum tercatat di aplikasi")}</h3>
                {match.unmatchedLines.length ? (
                  <ul className="divide-y rounded-xl border">
                    {match.unmatchedLines.map((l) => (
                      <li
                        key={l.line}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{l.description || "-"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {dateLabel(l.date, locale)} ·{" "}
                            <span className={l.amount >= 0 ? "text-income" : "text-expense"}>
                              {money(l.amount, currency)}
                            </span>
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRecord(draftFromLine(l, accountId, currency))}
                        >
                          {t("Catat")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("Semua baris bank cocok.")}</p>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold">{t("Tidak ada di mutasi bank")}</h3>
                {match.unmatchedTx.length ? (
                  <ul className="divide-y rounded-xl border">
                    {match.unmatchedTx.map((tx: any) => {
                      const v = signedAmount(tx, accountId);
                      return (
                        <li
                          key={tx.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {tx.description || tx.merchant || tx.category?.name || "-"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {dateLabel(tx.occurred_at, locale)}
                            </span>
                          </span>
                          <span
                            className={`num text-sm ${v >= 0 ? "text-income" : "text-expense"}`}
                          >
                            {money(v, currency)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("Semua transaksi aplikasi cocok.")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Figure({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num break-words text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
