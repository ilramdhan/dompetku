import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination } from "@/components/pagination";
import { Segmented } from "@/components/segmented";
import { confirmSignalFn, ignoreSignalFn } from "@/lib/payment-signals.functions";
import { errMsg, invalidateFor, paymentSignalsQuery, type SignalFilter } from "@/lib/queries";
import {
  OPEN_SIGNAL_STATUSES,
  SIGNAL_STATUS_LABEL,
  splitSignalAmount,
  type SignalStatus,
} from "@/lib/bank-notify";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

type OpenInvoice = {
  id: string;
  number: string;
  customer_name: string;
  remaining: number;
  unique_code: number | null;
};
type Signal = {
  id: string;
  app: string | null;
  device: string | null;
  excerpt: string | null;
  format_name: string | null;
  amount: number | null;
  posted_at: string | null;
  received_at: string;
  status: SignalStatus;
  reason: string | null;
  invoice_id: string | null;
  candidate_ids: string[];
  last_error: string | null;
  invoice: OpenInvoice | null;
};
type Data =
  | { ready: false }
  | { ready: true; items: Signal[]; total: number; open: number; invoices: OpenInvoice[] };

const PAGE = 10;

const STATUS_CLASS: Record<SignalStatus, string> = {
  matched: "border-transparent bg-primary/15 text-primary",
  ambiguous: "border-transparent bg-warning/15 text-warning",
  unmatched: "border-transparent bg-muted text-muted-foreground",
  confirmed: "border-transparent bg-income/15 text-income",
  ignored: "border-transparent bg-muted text-muted-foreground",
};

/**
 * Bank notifications from MacroDroid (v26, issue #96) waiting for the admin: matched ones mark the
 * invoice "Menunggu verifikasi"; ambiguous/unmatched ones can be assigned to an open invoice by
 * hand. Confirm books the payment (+ the unique code as a small extra income); ignore keeps the row.
 * Hidden before v26 and while nothing was ever received.
 */
export function SignalQueue({ locale }: { locale: string }) {
  usePrivacy();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<SignalFilter>("open");
  const [offset, setOffset] = useState(0);
  const q = useQuery({ ...paymentSignalsQuery(filter, offset, PAGE), placeholderData: (p) => p });
  const ignore = useServerFn(ignoreSignalFn);
  const [confirm, setConfirm] = useState<Signal | null>(null);
  const data = q.data as Data | undefined;

  if (!data || !data.ready) return null;
  if (filter === "open" && offset === 0 && data.total === 0 && data.open === 0) return null;

  async function doIgnore(s: Signal) {
    try {
      await ignore({ data: { id: s.id } });
      await invalidateFor(qc, "payment_signals");
      toast.success(t("Notifikasi diabaikan"));
    } catch (e) {
      toast.error(t(errMsg(e)));
    }
  }

  return (
    <Card className="mb-4 min-w-0 p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing className="size-4" aria-hidden /> {t("Notifikasi bank")}
          {data.open ? (
            <Badge className={STATUS_CLASS.matched}>
              {data.open} {t("perlu dicek")}
            </Badge>
          ) : null}
        </h2>
        <Segmented
          label={t("Filter notifikasi")}
          value={filter}
          onValueChange={(v) => {
            setFilter(v as SignalFilter);
            setOffset(0);
          }}
          options={[
            { value: "open", label: t("Perlu dicek") },
            { value: "confirmed", label: t("Dikonfirmasi") },
            { value: "ignored", label: t("Diabaikan") },
            { value: "all", label: t("Semua") },
          ]}
          className="max-w-full overflow-x-auto"
        />
      </div>
      {data.items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("Tidak ada notifikasi.")}</p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border">
          {data.items.map((s) => {
            const open = OPEN_SIGNAL_STATUSES.includes(s.status);
            return (
              <li key={s.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.invoice ? (
                        <>
                          <span className="num text-xs text-muted-foreground">
                            {s.invoice.number}
                          </span>{" "}
                          · {s.invoice.customer_name}
                        </>
                      ) : (
                        (s.app ?? t("Aplikasi tidak dikenal"))
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dateLabel((s.posted_at ?? s.received_at).slice(0, 10), locale)}
                      {s.format_name ? ` · ${t(s.format_name)}` : ""}
                      {s.device ? ` · ${s.device}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num font-semibold">{s.amount != null ? money(s.amount) : "—"}</p>
                    <Badge className={STATUS_CLASS[s.status]}>
                      {t(SIGNAL_STATUS_LABEL[s.status])}
                    </Badge>
                  </div>
                </div>
                {s.excerpt ? (
                  <p className="num-sensitive break-words text-xs text-muted-foreground">
                    {s.excerpt}
                  </p>
                ) : null}
                {s.reason || s.last_error ? (
                  <p className="break-words text-xs text-warning">
                    {t(s.last_error ?? s.reason ?? "")}
                  </p>
                ) : null}
                {open ? (
                  <div className="flex flex-wrap gap-2">
                    {s.amount != null ? (
                      <Button size="sm" onClick={() => setConfirm(s)}>
                        <Check className="size-4" aria-hidden /> {t("Konfirmasi")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => void doIgnore(s)}
                    >
                      <X className="size-4" aria-hidden /> {t("Abaikan")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        offset={offset}
        pageSize={PAGE}
        total={data.total}
        visible={data.items.length}
        onChange={setOffset}
      />
      {confirm ? (
        <ConfirmDialog signal={confirm} invoices={data.invoices} onClose={() => setConfirm(null)} />
      ) : null}
    </Card>
  );
}

function ConfirmDialog({
  signal,
  invoices,
  onClose,
}: {
  signal: Signal;
  invoices: OpenInvoice[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const run = useServerFn(confirmSignalFn);
  // Matched → that invoice; ambiguous → first candidate; else the admin picks.
  const initial =
    signal.invoice_id && invoices.some((i) => i.id === signal.invoice_id)
      ? signal.invoice_id
      : (signal.candidate_ids.find((id) => invoices.some((i) => i.id === id)) ?? "");
  const [invoiceId, setInvoiceId] = useState(initial);
  const inv = invoices.find((i) => i.id === invoiceId) ?? null;
  const received = Number(signal.amount ?? 0);
  const split = inv ? splitSignalAmount(received, inv.remaining, inv.unique_code) : null;
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(signal.posted_at ? signal.posted_at.slice(0, 10) : todayStr());
  const [busy, setBusy] = useState(false);
  const shown = amount || (split ? String(split.extra ? received : split.pay) : "");
  // Candidates first (ambiguous), then the other open invoices.
  const ordered = [
    ...invoices.filter((i) => signal.candidate_ids.includes(i.id)),
    ...invoices.filter((i) => !signal.candidate_ids.includes(i.id)),
  ];

  async function submit() {
    const v = Number(shown);
    if (!inv) {
      toast.error(t("Pilih invoice"));
      return;
    }
    if (!(v > 0)) {
      toast.error(t("Jumlah harus lebih dari 0"));
      return;
    }
    setBusy(true);
    try {
      await run({ data: { id: signal.id, invoice_id: inv.id, amount: v, paid_at: date || null } });
      await invalidateFor(qc, "payment_signals");
      toast.success(t("Pembayaran dicatat"));
      onClose();
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Konfirmasi notifikasi")}</DialogTitle>
          <DialogDescription>
            {t("Diterima")} {money(received, "IDR", { reveal: true })} ·{" "}
            {t("Tercatat sebagai pemasukan kategori Invoice.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="sg-inv">{t("Invoice")}</Label>
            <Select
              value={invoiceId}
              onValueChange={(v) => {
                setInvoiceId(v);
                setAmount("");
              }}
            >
              <SelectTrigger id="sg-inv" className="min-w-0">
                <SelectValue placeholder={t("Pilih invoice")} />
              </SelectTrigger>
              <SelectContent>
                {ordered.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} · {i.customer_name} · {money(i.remaining, "IDR", { reveal: true })}
                    {i.unique_code ? ` + ${i.unique_code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="sg-amount">{t("Jumlah diterima")}</Label>
            <Input
              id="sg-amount"
              className="num"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={shown}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="sg-date">{t("Tanggal")}</Label>
            <Input
              id="sg-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {split?.extra && Number(shown) === received ? (
            <p className="col-span-2 text-xs text-muted-foreground">
              {t("Kode unik")} {split.extra} {t("dicatat sebagai pemasukan tambahan.")}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Batal")}
          </Button>
          <Button disabled={busy || !inv} onClick={() => void submit()}>
            <Check className="size-4" aria-hidden /> {busy ? t("Menyimpan…") : t("Konfirmasi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
