import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, Link2, Link2Off, Mail, MessageCircle, RefreshCw } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { useIsDemo } from "@/components/demo";
import { seoQuery } from "@/components/landing/seo-config";
import {
  createInvoiceShareFn,
  revokeInvoiceShareFn,
  sendInvoiceEmailFn,
} from "@/lib/invoices.functions";
import { errMsg, invalidateFor, invoiceShareQuery } from "@/lib/queries";
import {
  DEMO_SHARE_MAX_DAYS,
  SHARE_EXPIRY_DAYS,
  isPublicStatus,
  shareUrl,
  waShareUrl,
} from "@/lib/invoice-share";
import { dateLabel } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import type { InvoiceStatus } from "@/lib/invoices";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "Bagikan" block in the invoice detail (issue #93): create / rotate / revoke the public link with
 * an optional expiry, then copy it, share it via wa.me or preview it. Only the hash is stored, so
 * the raw link exists in this component's state right after creating it; later the admin rotates
 * to get a new one.
 */
export function InvoiceSharePanel({
  invoice,
  locale,
}: {
  invoice: {
    id: string;
    number: string;
    status: InvoiceStatus;
    customer_name: string;
    customer_phone?: string | null;
    customer_email?: string | null;
    remaining: number;
  };
  locale: string;
}) {
  usePrivacy();
  const { t } = useI18n();
  const qc = useQueryClient();
  const ask = useConfirm();
  const demo = useIsDemo();
  const siteUrl = useQuery(seoQuery()).data?.siteUrl ?? null;
  const shareable = isPublicStatus(invoice.status);
  const status = useQuery({ ...invoiceShareQuery(invoice.id), enabled: shareable });
  const create = useServerFn(createInvoiceShareFn);
  const revoke = useServerFn(revokeInvoiceShareFn);
  const sendMail = useServerFn(sendInvoiceEmailFn);
  const [days, setDays] = useState("0");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!shareable)
    return (
      <p className="text-muted-foreground">
        {t("Terbitkan invoice dulu untuk membuat tautan publik.")}
      </p>
    );
  const s = status.data as any;
  if (status.isLoading) return <p className="text-muted-foreground">{t("Memuat…")}</p>;
  if (status.error) return <p className="text-expense">{errMsg(status.error)}</p>;
  if (s && s.ready === false)
    return (
      <p className="text-muted-foreground">
        {t("Tautan publik invoice belum aktif: jalankan bagian v23 di supabase/schema.sql.")}
      </p>
    );

  const state: string = s?.state ?? "none";

  async function generate() {
    if (
      state === "active" &&
      !(await ask.confirm(t("Buat tautan baru? Tautan lama tidak bisa dibuka lagi."), {
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const r = await create({ data: { id: invoice.id, expires_days: Number(days) || null } });
      // Event handler only (never during render): PUBLIC_SITE_URL, else the current origin.
      setLink(shareUrl(siteUrl ?? window.location.origin, r.token));
      await invalidateFor(qc, "invoice_shares");
      toast.success(t("Tautan dibuat"));
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(false);
    }
  }

  /** "Kirim invoice" (#95): emails the link; an existing link is rotated, so confirm first. */
  async function sendEmail() {
    const rotates = state === "active";
    if (
      !(await ask.confirm(
        rotates
          ? t(
              "Kirim invoice ke email pelanggan? Tautan lama akan diganti dan tidak bisa dibuka lagi.",
            )
          : t("Kirim invoice ke email pelanggan?"),
        {
          description: `${invoice.customer_email} · ${
            rotates
              ? t(
                  "Demi keamanan hanya hash tautan yang disimpan, jadi tautan baru dibuat saat mengirim.",
                )
              : t("Tautan publik dibuat otomatis.")
          }`,
          destructive: rotates,
        },
      ))
    )
      return;
    setBusy(true);
    try {
      const r = await sendMail({ data: { id: invoice.id, expires_days: Number(days) || null } });
      if (r.link) setLink(r.link);
      await invalidateFor(qc, "invoice_shares");
      if (r.sent) toast.success(`${t("Email terkirim ke")} ${r.to}`);
      else
        toast.error(
          `${t(r.reason ?? "Gagal mengirim email.")} ${t("Tautan baru tetap dibuat dan tampil di bawah.")}`,
        );
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke() {
    if (
      !(await ask.confirm(t("Cabut tautan publik invoice ini?"), {
        description: t("Pelanggan tidak bisa membuka tautan ini lagi."),
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await revoke({ data: { id: invoice.id } });
      setLink(null);
      await invalidateFor(qc, "invoice_shares");
      toast.success(t("Tautan dicabut"));
    } catch (e) {
      toast.error(t(errMsg(e)));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("Disalin"));
    } catch {
      toast.error(t("Gagal menyalin"));
    }
  }

  // The message goes to the customer: amounts are never masked there.
  const waText = link
    ? `${t("Halo")} ${invoice.customer_name}, ${t("berikut invoice")} ${invoice.number} (${t("sisa")} ${money(invoice.remaining, "IDR", { reveal: true })}): ${link}`
    : "";

  const stateText: Record<string, string> = {
    none: t("Belum ada tautan publik."),
    active: s?.expires_at
      ? `${t("Tautan aktif, berlaku sampai")} ${dateLabel(s.expires_at, locale)}.`
      : t("Tautan aktif, tanpa kedaluwarsa."),
    expired: t("Tautan sudah kedaluwarsa."),
    revoked: t("Tautan sudah dicabut."),
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 font-medium">
        <Link2 className="size-4" aria-hidden /> {t("Bagikan")}
      </p>
      <p className="text-muted-foreground">{stateText[state] ?? stateText["none"]}</p>
      {link ? (
        <>
          <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{link}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Simpan tautan ini sekarang: demi keamanan hanya hash-nya yang disimpan. Buat ulang untuk tautan baru.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="size-4" /> {t("Salin tautan")}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a
                href={waShareUrl(waText, invoice.customer_phone)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="size-4" /> {t("Kirim via WhatsApp")}
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> {t("Pratinjau")}
              </a>
            </Button>
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`share-exp-${invoice.id}`} className="text-xs">
            {t("Kedaluwarsa")}
          </Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger id={`share-exp-${invoice.id}`} className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHARE_EXPIRY_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 0 ? t("Tanpa kedaluwarsa") : `${d} ${t("hari")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={generate} disabled={busy}>
          {state === "none" ? <Link2 className="size-4" /> : <RefreshCw className="size-4" />}
          {state === "none" ? t("Buat tautan") : t("Buat ulang tautan")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={sendEmail}
          disabled={busy || demo || !invoice.customer_email}
          title={!invoice.customer_email ? t("Pelanggan belum punya alamat email.") : undefined}
        >
          <Mail className="size-4" /> {t("Kirim invoice")}
        </Button>
        {state === "active" ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-expense"
            onClick={doRevoke}
            disabled={busy}
          >
            <Link2Off className="size-4" /> {t("Cabut")}
          </Button>
        ) : null}
      </div>
      {demo ? (
        <p className="text-xs text-muted-foreground">
          {t("Mode demo: tautan kedaluwarsa dalam")} {DEMO_SHARE_MAX_DAYS} {t("hari")}.
        </p>
      ) : null}
      {ask.element}
    </div>
  );
}
