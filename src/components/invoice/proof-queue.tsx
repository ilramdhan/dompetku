import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Eye, Inbox, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Pagination } from "@/components/pagination";
import { Segmented } from "@/components/segmented";
import { approveProofFn, getProofUrlFn, rejectProofFn } from "@/lib/invoices.functions";
import { errMsg, invalidateFor, invoiceProofsQuery, type ProofFilter } from "@/lib/queries";
import { PROOF_LIMITS, PROOF_STATUS_LABEL, type ProofStatus } from "@/lib/invoice-payments";
import { dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

type Proof = {
  id: string;
  invoice_id: string;
  claimed_amount: number;
  payer_name: string | null;
  note: string | null;
  status: ProofStatus;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  method: { label: string; kind: string } | null;
  invoice: { number: string; customer_name: string; status: string; remaining: number };
};

const PAGE = 10;

const STATUS_CLASS: Record<ProofStatus, string> = {
  pending: "border-transparent bg-primary/15 text-primary",
  approved: "border-transparent bg-income/15 text-income",
  rejected: "border-transparent bg-expense/15 text-expense",
};

/**
 * Admin verification queue of customer transfer proofs (v24, issue #94). Pending proofs first
 * (oldest first), history via the filter. Preview = 2-minute signed URL; approve books a payment
 * via recordPayment (amount editable, ≤ remaining); reject needs a reason.
 */
export function ProofQueue({ locale }: { locale: string }) {
  usePrivacy();
  const { t } = useI18n();
  const [filter, setFilter] = useState<ProofFilter>("pending");
  const [offset, setOffset] = useState(0);
  const q = useQuery({ ...invoiceProofsQuery(filter, offset, PAGE), placeholderData: (p) => p });
  const [preview, setPreview] = useState<string | null>(null);
  const [approve, setApprove] = useState<Proof | null>(null);
  const [reject, setReject] = useState<Proof | null>(null);
  const url = useServerFn(getProofUrlFn);
  const data = q.data as
    { ready: false } | { ready: true; items: Proof[]; total: number; pending: number } | undefined;

  if (!data || !data.ready) return null;

  async function open(p: Proof) {
    try {
      const r = await url({ data: { id: p.id } });
      setPreview(r.url);
    } catch (e) {
      toast.error(t(errMsg(e)));
    }
  }

  return (
    <Card className="mb-4 min-w-0 p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Inbox className="size-4" aria-hidden /> {t("Bukti transfer")}
          {data.pending ? (
            <Badge className={STATUS_CLASS.pending}>
              {data.pending} {t("menunggu")}
            </Badge>
          ) : null}
        </h2>
        <Segmented
          label={t("Filter bukti")}
          value={filter}
          onValueChange={(v) => {
            setFilter(v as ProofFilter);
            setOffset(0);
          }}
          options={[
            { value: "pending", label: t("Menunggu") },
            { value: "approved", label: t("Disetujui") },
            { value: "rejected", label: t("Ditolak") },
            { value: "all", label: t("Semua") },
          ]}
          className="max-w-full overflow-x-auto"
        />
      </div>
      {data.items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {filter === "pending"
            ? t("Tidak ada bukti yang menunggu verifikasi.")
            : t("Belum ada bukti.")}
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border">
          {data.items.map((p) => (
            <li key={p.id} className="space-y-2 px-3 py-3 text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <span className="num text-xs text-muted-foreground">{p.invoice.number}</span> ·{" "}
                    {p.invoice.customer_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dateLabel(p.created_at.slice(0, 10), locale)}
                    {p.method ? ` · ${p.method.label}` : ""}
                    {p.payer_name ? ` · ${p.payer_name}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{money(p.claimed_amount)}</p>
                  <Badge className={STATUS_CLASS[p.status]}>
                    {t(PROOF_STATUS_LABEL[p.status])}
                  </Badge>
                </div>
              </div>
              {p.note ? (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{p.note}</p>
              ) : null}
              {p.reject_reason ? (
                <p className="break-words text-xs text-expense">
                  {t("Alasan")}: {p.reject_reason}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => open(p)}>
                  <Eye className="size-4" aria-hidden /> {t("Lihat bukti")}
                </Button>
                {p.status === "pending" ? (
                  <>
                    <Button size="sm" onClick={() => setApprove(p)}>
                      <Check className="size-4" aria-hidden /> {t("Setujui")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-expense"
                      onClick={() => setReject(p)}
                    >
                      <X className="size-4" aria-hidden /> {t("Tolak")}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        offset={offset}
        pageSize={PAGE}
        total={data.total}
        visible={data.items.length}
        onChange={setOffset}
      />
      <Dialog open={!!preview} onOpenChange={(o) => (!o ? setPreview(null) : null)}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Bukti transfer")}</DialogTitle>
            <DialogDescription>{t("Tautan pratinjau berlaku 2 menit.")}</DialogDescription>
          </DialogHeader>
          {preview ? (
            <img
              src={preview}
              alt={t("Bukti transfer")}
              referrerPolicy="no-referrer"
              className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {approve ? <ApproveDialog proof={approve} onClose={() => setApprove(null)} /> : null}
      {reject ? <RejectDialog proof={reject} onClose={() => setReject(null)} /> : null}
    </Card>
  );
}

function ApproveDialog({ proof, onClose }: { proof: Proof; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const run = useServerFn(approveProofFn);
  const max = proof.invoice.remaining;
  const [amount, setAmount] = useState(String(Math.min(proof.claimed_amount, max)));
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = Number(amount);
    if (!(v > 0)) {
      toast.error(t("Jumlah harus lebih dari 0"));
      return;
    }
    if (v > max + 0.005) {
      toast.error(t("Pembayaran melebihi sisa tagihan"));
      return;
    }
    setBusy(true);
    try {
      await run({ data: { id: proof.id, amount: v, paid_at: date || null } });
      await invalidateFor(qc, "invoice_proofs");
      toast.success(t("Bukti disetujui, pembayaran dicatat"));
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
          <DialogTitle>{t("Setujui bukti")}</DialogTitle>
          <DialogDescription>
            {proof.invoice.number} · {t("Sisa")} {money(max, "IDR", { reveal: true })} ·{" "}
            {t("Tercatat sebagai pemasukan kategori Invoice.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="ap-amount">{t("Jumlah diterima")}</Label>
            <Input
              id="ap-amount"
              className="num"
              type="number"
              inputMode="decimal"
              min={1}
              max={max}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="ap-date">{t("Tanggal")}</Label>
            <Input
              id="ap-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Batal")}
          </Button>
          <Button disabled={busy} onClick={submit}>
            <Check className="size-4" aria-hidden /> {busy ? t("Menyimpan…") : t("Setujui")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ proof, onClose }: { proof: Proof; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const run = useServerFn(rejectProofFn);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) {
      toast.error(t("Alasan penolakan wajib diisi"));
      return;
    }
    setBusy(true);
    try {
      await run({ data: { id: proof.id, reason } });
      await invalidateFor(qc, "invoice_proofs");
      toast.success(t("Bukti ditolak"));
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
          <DialogTitle>{t("Tolak bukti")}</DialogTitle>
          <DialogDescription>
            {proof.invoice.number} · {proof.invoice.customer_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rj-reason">{t("Alasan penolakan")}</Label>
          <Textarea
            id="rj-reason"
            maxLength={PROOF_LIMITS.reject_reason}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Batal")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={submit}>
            <X className="size-4" aria-hidden /> {busy ? t("Menyimpan…") : t("Tolak")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
