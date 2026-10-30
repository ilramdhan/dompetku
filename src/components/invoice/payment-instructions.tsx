import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Copy, Landmark, QrCode, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitInvoiceProof } from "@/lib/invoice-public.functions";
import type { PublicInvoiceView } from "@/lib/invoice-share";
import { PROOF_LIMITS, PROOF_MAX_SIDE, type PublicMethod } from "@/lib/invoice-payments";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/**
 * "How to pay" on the public invoice page (v24, issue #94): the bank accounts / static QRIS picked
 * for the invoice (whitelisted server-side by `toPublicMethod()`: no wallet, no ids), the amount to
 * pay (= remaining, never masked) and the transfer-proof upload. The photo is re-encoded in the
 * browser (JPEG, longest side PROOF_MAX_SIDE, drops EXIF) and the server sniffs it again. The
 * customer never gets a file URL back, only a confirmation. Upload is hidden in demo mode.
 */
export function InvoicePaymentInstructions({
  invoice,
  token,
}: {
  invoice: PublicInvoiceView;
  token: string;
}) {
  const { t } = useI18n();
  const p = invoice.payment;
  if (!p) return null;
  const hasMethods = p.methods.length > 0;
  if (!hasMethods && !p.upload && !p.pending) return null;
  const amount = money(invoice.remaining, invoice.currency, { reveal: true });

  return (
    <section className="mt-8 space-y-4" aria-labelledby="invoice-howto">
      <h2 id="invoice-howto" className="text-sm font-semibold">
        {t("Cara membayar")}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t("Jumlah yang dibayar")}</span>
        <span className="flex items-center gap-1">
          <span className="num text-base font-bold">{amount}</span>
          <CopyButton value={String(Math.round(invoice.remaining))} label={t("Salin jumlah")} />
        </span>
      </div>
      {p.pending > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("Bukti diterima, menunggu verifikasi")}
        </p>
      ) : null}
      {hasMethods ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {p.methods.map((m) => (
            <MethodCard key={m.ref} m={m} />
          ))}
        </ul>
      ) : null}
      {p.upload ? (
        <ProofForm invoice={invoice} token={token} />
      ) : p.upload_off && hasMethods ? (
        <p className="no-print text-xs text-muted-foreground">{t(p.upload_off)}</p>
      ) : null}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked: the value is visible anyway */
    }
  }
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="no-print size-9 sm:size-8"
      onClick={copy}
      aria-label={label}
      title={done ? t("Disalin") : label}
    >
      {done ? (
        <CheckCircle2 className="size-4 text-income" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </Button>
  );
}

function MethodCard({ m }: { m: PublicMethod }) {
  const { t } = useI18n();
  return (
    <li className="min-w-0 rounded-lg border p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        {m.kind === "qris" ? (
          <QrCode className="size-4 shrink-0" aria-hidden />
        ) : (
          <Landmark className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 break-words">{m.label}</span>
      </p>
      {m.kind === "bank" ? (
        <dl className="mt-2 space-y-1">
          {m.bank_name ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("Bank")}</dt>
              <dd className="min-w-0 break-words text-right">{m.bank_name}</dd>
            </div>
          ) : null}
          {m.account_number ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t("No. rekening")}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="num break-all font-semibold">{m.account_number}</span>
                <CopyButton
                  value={m.account_number.replace(/[\s.-]/g, "")}
                  label={t("Salin nomor rekening")}
                />
              </dd>
            </div>
          ) : null}
          {m.account_holder ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("Atas nama")}</dt>
              <dd className="min-w-0 break-words text-right">{m.account_holder}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <div className="mt-2 space-y-1">
          {m.qris_image ? (
            <img
              src={m.qris_image}
              alt={`${t("Kode QRIS")} ${m.label}`}
              className="mx-auto aspect-square w-full max-w-60 rounded-md bg-white object-contain p-2"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          {m.account_holder ? (
            <p className="text-center text-muted-foreground">
              {t("Atas nama")} {m.account_holder}
            </p>
          ) : null}
          <p className="text-center text-xs text-muted-foreground">
            {t("Pindai dengan aplikasi bank atau e-wallet.")}
          </p>
        </div>
      )}
    </li>
  );
}

/** Re-encodes a photo as JPEG (longest side PROOF_MAX_SIDE); drops metadata such as GPS. */
async function encodeProof(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PROOF_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bmp.close();
  }
}

/** Largest original file the browser will try to re-encode. */
const MAX_PICK_BYTES = 20 * 1024 * 1024;

function ProofForm({ invoice, token }: { invoice: PublicInvoiceView; token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const submit = useServerFn(submitInvoiceProof);
  const methods = invoice.payment.methods;
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(String(Math.round(invoice.remaining)));
  const [method, setMethod] = useState(methods.length === 1 ? "0" : "");
  const [payer, setPayer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!file) return setError(t("Pilih foto bukti transfer"));
    if (!file.type.startsWith("image/") || file.size > MAX_PICK_BYTES)
      return setError(t("Format gambar tidak didukung (JPEG/PNG/WebP)."));
    if (!(value > 0)) return setError(t("Jumlah harus lebih dari 0"));
    if (value > invoice.remaining + 0.005) return setError(t("Jumlah melebihi sisa tagihan"));
    setBusy(true);
    try {
      let image: string;
      try {
        image = await encodeProof(file);
      } catch {
        throw new Error("Gambar tidak bisa dibaca");
      }
      await submit({
        data: {
          token,
          method_ref: method === "" ? null : Number(method),
          claimed_amount: value,
          payer_name: payer || null,
          note: note || null,
          image,
        },
      });
      setSent(true);
      setFile(null);
      await router.invalidate();
    } catch (err) {
      setError(t(err instanceof Error ? err.message : "Bukti gagal dikirim, coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <p
        role="status"
        className="no-print flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-income"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("Terima kasih! Bukti transfer terkirim dan akan diperiksa penjual.")}
      </p>
    );

  return (
    <form
      onSubmit={onSubmit}
      className="no-print grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2 sm:p-4"
      aria-labelledby="proof-title"
    >
      <div className="sm:col-span-2">
        <h3 id="proof-title" className="flex items-center gap-2 text-sm font-semibold">
          <Upload className="size-4" aria-hidden /> {t("Sudah transfer? Unggah bukti")}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("Foto atau tangkapan layar bukti transfer (JPEG/PNG/WebP, maks. 5 MB).")}
        </p>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="proof-file">{t("Bukti transfer")}</Label>
        <Input
          id="proof-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proof-amount">{t("Jumlah yang ditransfer")}</Label>
        <Input
          id="proof-amount"
          className="num"
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          max={invoice.remaining}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {methods.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="proof-method">{t("Metode")}</Label>
          <select
            id="proof-method"
            className="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">{t("Pilih metode (opsional)")}</option>
            {methods.map((m) => (
              <option key={m.ref} value={String(m.ref)}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="proof-payer">{t("Nama pengirim (opsional)")}</Label>
        <Input
          id="proof-payer"
          maxLength={PROOF_LIMITS.payer_name}
          autoComplete="name"
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="proof-note">{t("Catatan (opsional)")}</Label>
        <Textarea
          id="proof-note"
          maxLength={PROOF_LIMITS.note}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-expense sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          <Upload className="size-4" aria-hidden />
          {busy ? t("Mengirim…") : t("Kirim bukti")}
        </Button>
      </div>
    </form>
  );
}
