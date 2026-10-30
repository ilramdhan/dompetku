import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useConfirm } from "@/components/confirm-dialog";
import { refundGatewayFn, syncGatewayFn } from "@/lib/invoices.functions";
import { errMsg, gatewayTxQuery, invalidateFor } from "@/lib/queries";
import {
  FULL_REFUND_ONLY_TYPES,
  GATEWAY_STATUS_LABEL,
  REFUNDABLE_TYPES,
  refundableLeft,
  type GatewayStatus,
} from "@/lib/gateway/types";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";

type GatewayItem = {
  id: string;
  order_id: string;
  gateway_tx_id: string | null;
  status: GatewayStatus;
  gross_amount: number;
  refunded_amount: number;
  payment_type: string | null;
  payment_id: string | null;
  last_error: string | null;
  created_at: string;
};

const STATUS_CLASS: Record<GatewayStatus, string> = {
  pending: "border-transparent bg-secondary text-secondary-foreground",
  success: "border-transparent bg-income/15 text-income",
  failed: "border-transparent bg-expense/15 text-expense",
  expired: "border-transparent bg-muted text-muted-foreground",
  refunded: "border-transparent bg-warning/15 text-warning",
  partial_refund: "border-transparent bg-warning/15 text-warning",
};

const canRefund = (g: GatewayItem) =>
  (g.status === "success" || g.status === "partial_refund") &&
  !!g.payment_id &&
  (REFUNDABLE_TYPES as readonly string[]).includes(g.payment_type ?? "") &&
  refundableLeft(g) > 0;

/**
 * Midtrans orders of one invoice (v25, issue #97): status, amount, time, "Cek status" (re-reads
 * the order from Midtrans, e.g. when a webhook was missed) and refund with confirmation. Hidden
 * before v25 and when the invoice never had an order.
 */
export function GatewayPanel({ invoiceId, locale }: { invoiceId: string; locale: string }) {
  usePrivacy();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery(gatewayTxQuery(invoiceId));
  const sync = useServerFn(syncGatewayFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<GatewayItem | null>(null);
  const d = data as { ready: boolean; configured?: boolean; items: GatewayItem[] } | undefined;
  if (!d?.ready || !d.items.length) return null;

  async function check(g: GatewayItem) {
    setBusy(g.id);
    try {
      const r = await sync({ data: { id: g.id } });
      await invalidateFor(qc, "gateway_transactions");
      toast.success(
        `${t("Status diperbarui")}: ${t(GATEWAY_STATUS_LABEL[r.status as GatewayStatus] ?? r.status)}`,
      );
      if (r.note) toast.error(t(r.note));
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(null);
    }
  }

  const time = (s: string) =>
    new Date(s).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        <CreditCard className="size-4" aria-hidden /> {t("Transaksi Midtrans")}
      </p>
      <ul className="divide-y rounded-lg border">
        {d.items.map((g) => (
          <li key={g.id} className="space-y-1 px-3 py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <span className="min-w-0">
                <span className="num block truncate text-xs text-muted-foreground">
                  {g.order_id}
                </span>
                <span className="text-xs text-muted-foreground">
                  {time(g.created_at)}
                  {g.payment_type ? ` · ${g.payment_type}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="num font-medium">{money(g.gross_amount)}</span>
                <Badge className={STATUS_CLASS[g.status]}>
                  {t(GATEWAY_STATUS_LABEL[g.status])}
                </Badge>
              </span>
            </div>
            {g.refunded_amount > 0 ? (
              <p className="text-xs text-warning">
                {t("Dikembalikan")}: <span className="num">{money(g.refunded_amount)}</span>
              </p>
            ) : null}
            {g.last_error ? (
              <p className="text-xs break-words text-expense">{t(g.last_error)}</p>
            ) : null}
            {d.configured ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 sm:h-8"
                  disabled={busy === g.id}
                  onClick={() => void check(g)}
                >
                  <RefreshCw className="size-3.5" aria-hidden /> {t("Cek status")}
                </Button>
                {canRefund(g) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 text-expense sm:h-8"
                    onClick={() => setRefundFor(g)}
                  >
                    <Undo2 className="size-3.5" aria-hidden /> {t("Refund")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <RefundDialog item={refundFor} onClose={() => setRefundFor(null)} />
    </div>
  );
}

function RefundDialog({ item, onClose }: { item: GatewayItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const refund = useServerFn(refundGatewayFn);
  const ask = useConfirm();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const left = item ? refundableLeft(item) : 0;
  const fullOnly = (FULL_REFUND_ONLY_TYPES as readonly string[]).includes(item?.payment_type ?? "");
  const value = amount.trim() === "" ? left : Number(amount);

  async function submit() {
    if (!item) return;
    if (!Number.isInteger(value) || value <= 0 || value > left) {
      toast.error(t("Jumlah refund tidak valid"));
      return;
    }
    const ok = await ask.confirm(t("Kirim refund ke Midtrans?"), {
      description: `${money(value, "IDR", { reveal: true })} · ${t(
        "Dana dikembalikan ke pelanggan dan tidak bisa dibatalkan. Pengeluaran pembalik dicatat di kategori Invoice.",
      )}`,
      confirmLabel: t("Refund"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await refund({ data: { id: item.id, amount: value, reason } });
      await invalidateFor(qc, "gateway_transactions");
      toast.success(t("Refund dikirim"));
      setAmount("");
      setReason("");
      onClose();
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Refund Midtrans")}</DialogTitle>
          <DialogDescription>
            {t("Sisa yang bisa dikembalikan")}:{" "}
            <span className="num font-semibold">{money(left, "IDR", { reveal: true })}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gw-refund-amount">{t("Jumlah")}</Label>
            <Input
              id="gw-refund-amount"
              inputMode="numeric"
              disabled={fullOnly || busy}
              placeholder={String(left)}
              value={fullOnly ? String(left) : amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            />
            {fullOnly ? (
              <p className="text-xs text-muted-foreground">
                {t("Metode ini hanya mendukung refund penuh")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gw-refund-reason">{t("Alasan (opsional)")}</Label>
            <Input
              id="gw-refund-reason"
              maxLength={255}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("Batal")}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {t("Refund")}
          </Button>
        </DialogFooter>
        {ask.element}
      </DialogContent>
    </Dialog>
  );
}
