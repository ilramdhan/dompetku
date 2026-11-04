import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImageUp, Landmark, Pencil, Plus, QrCode, Trash2, Wallet } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/confirm-dialog";
import { useIsDemo } from "@/components/demo";
import { deletePaymentMethodFn, savePaymentMethodFn } from "@/lib/invoices.functions";
import { errMsg, invalidateFor, paymentMethodsQuery, rowsQuery } from "@/lib/queries";
import {
  METHOD_KINDS,
  METHOD_KIND_LABEL,
  METHOD_LIMITS,
  validateMethod,
  type MethodKind,
  type PaymentMethodRow,
} from "@/lib/invoice-payments";
import { isLogoDataUrl, LOGO_SIZE } from "@/lib/app-settings";
import { useI18n } from "@/lib/i18n";
import type { Account } from "@/lib/schemas";

type Form = {
  id: string | null;
  kind: MethodKind;
  label: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  qris_image: string | null;
  account_id: string;
  active: boolean;
};

const empty = (): Form => ({
  id: null,
  kind: "bank",
  label: "",
  bank_name: "",
  account_number: "",
  account_holder: "",
  qris_image: null,
  account_id: "",
  active: true,
});

const NONE = "__none";

/** Fits a QRIS photo in LOGO_SIZE×2 on white and returns a ≤200 KB PNG/WebP data URL. */
async function encodeQris(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const max = LOGO_SIZE * 2;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    return isLogoDataUrl(png) ? png : canvas.toDataURL("image/webp", 0.9);
  } finally {
    bmp.close();
  }
}

/**
 * Settings → Metode pembayaran (v24, issue #94, admin only): bank accounts and static QRIS shown on
 * public invoices. The linked wallet is for the admin only and never reaches the public page.
 */
export function PaymentMethodsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const ask = useConfirm();
  const q = useQuery(paymentMethodsQuery());
  const del = useServerFn(deletePaymentMethodFn);
  const accounts = ((useQuery(rowsQuery("accounts")).data ?? []) as Account[]).filter(
    (a) => !a.archived,
  );
  const [form, setForm] = useState<Form | null>(null);
  const data = q.data as { ready: boolean; methods: PaymentMethodRow[] } | undefined;
  const ready = data?.ready ?? false;
  const accName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name;

  async function remove(m: PaymentMethodRow) {
    const ok = await ask.confirm(`${t("Hapus ")}${m.label}${t("?")}`, {
      description: t("Bukti yang sudah dikirim tetap tersimpan."),
      confirmLabel: t("Ya, hapus"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del({ data: { id: m.id } });
      await invalidateFor(qc, "payment_methods");
      toast.success(t("Dihapus"));
    } catch (e) {
      toast.error(t(errMsg(e)));
    }
  }

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Landmark className="size-4" aria-hidden /> {t("Metode pembayaran")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Rekening bank dan QRIS yang tampil di halaman invoice publik.")}
          </p>
        </div>
        {ready ? (
          <Button onClick={() => setForm(empty())}>
            <Plus className="size-4" aria-hidden /> {t("Tambah metode")}
          </Button>
        ) : null}
      </div>
      {q.isError ? <p className="mt-3 text-sm text-destructive">{errMsg(q.error)}</p> : null}
      {data && !ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("Metode pembayaran invoice belum aktif: jalankan bagian v24 di supabase/schema.sql.")}
        </p>
      ) : null}
      {ready && data!.methods.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("Belum ada metode pembayaran.")}</p>
      ) : null}
      {ready && data!.methods.length ? (
        <ul className="mt-4 divide-y rounded-lg border">
          {data!.methods.map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-2 font-medium">
                  {m.kind === "qris" ? (
                    <QrCode className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <Landmark className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{m.label}</span>
                  {!m.active ? <Badge variant="outline">{t("Nonaktif")}</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.kind === "bank"
                    ? [m.bank_name, m.account_number, m.account_holder].filter(Boolean).join(" · ")
                    : m.qris_image
                      ? t("Gambar QRIS terpasang")
                      : t("Belum ada gambar QRIS")}
                </p>
                {accName(m.account_id) ? (
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Wallet className="size-3" aria-hidden /> {accName(m.account_id)}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  aria-label={t("Ubah")}
                  onClick={() =>
                    setForm({
                      id: m.id,
                      kind: m.kind === "qris" ? "qris" : "bank",
                      label: m.label,
                      bank_name: m.bank_name ?? "",
                      account_number: m.account_number ?? "",
                      account_holder: m.account_holder ?? "",
                      qris_image: m.qris_image,
                      account_id: m.account_id ?? "",
                      active: m.active,
                    })
                  }
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 text-expense"
                  aria-label={t("Hapus")}
                  onClick={() => remove(m)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {form ? <MethodDialog form={form} accounts={accounts} onClose={() => setForm(null)} /> : null}
      {ask.element}
    </Card>
  );
}

function MethodDialog({
  form: initial,
  accounts,
  onClose,
}: {
  form: Form;
  accounts: Account[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const demo = useIsDemo();
  const save = useServerFn(savePaymentMethodFn);
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("Pilih berkas gambar"));
      return;
    }
    try {
      const data = await encodeQris(file);
      if (!isLogoDataUrl(data)) {
        toast.error(t("Gambar QRIS terlalu besar (maks. 200 KB)"));
        return;
      }
      set("qris_image", data);
    } catch {
      toast.error(t("Gambar tidak bisa dibaca"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const values = {
      kind: f.kind,
      label: f.label,
      bank_name: f.bank_name || null,
      account_number: f.account_number || null,
      account_holder: f.account_holder || null,
      qris_image: f.kind === "qris" ? f.qris_image : null,
      account_id: f.account_id || null,
      active: f.active,
    };
    const errors = validateMethod(values);
    if (errors.length) {
      toast.error(t("Gagal menyimpan"), { description: errors.map((x) => t(x)).join(" · ") });
      return;
    }
    setBusy(true);
    try {
      await save({ data: { id: f.id, values } });
      await invalidateFor(qc, "payment_methods");
      toast.success(t("Tersimpan"));
      onClose();
    } catch (err) {
      toast.error(t("Gagal menyimpan"), { description: t(errMsg(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? t("Ubah metode") : t("Tambah metode")}</DialogTitle>
          <DialogDescription>
            {t("Pelanggan melihat detail ini di halaman invoice. Dompet tidak pernah ditampilkan.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="pm-kind">{t("Jenis")}</Label>
            <Select value={f.kind} onValueChange={(v) => set("kind", v as MethodKind)}>
              <SelectTrigger id="pm-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(METHOD_KIND_LABEL[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="pm-label">{t("Nama metode")}</Label>
            <Input
              id="pm-label"
              maxLength={METHOD_LIMITS.label}
              placeholder={f.kind === "bank" ? "BCA" : "QRIS Toko"}
              value={f.label}
              onChange={(e) => set("label", e.target.value)}
            />
          </div>
          {f.kind === "bank" ? (
            <>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="pm-bank">{t("Nama bank")}</Label>
                <Input
                  id="pm-bank"
                  maxLength={METHOD_LIMITS.bank_name}
                  value={f.bank_name}
                  onChange={(e) => set("bank_name", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="pm-no">{t("No. rekening")}</Label>
                <Input
                  id="pm-no"
                  className="num"
                  inputMode="numeric"
                  maxLength={METHOD_LIMITS.account_number}
                  value={f.account_number}
                  onChange={(e) => set("account_number", e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="col-span-2 space-y-1.5">
              <Label>{t("Gambar QRIS")}</Label>
              <div className="flex flex-wrap items-center gap-3">
                {f.qris_image ? (
                  <img
                    src={f.qris_image}
                    alt={t("Kode QRIS")}
                    className="size-24 rounded-md border bg-white object-contain p-1"
                  />
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={demo}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageUp className="size-4" aria-hidden /> {t("Unggah gambar QRIS")}
                </Button>
                {f.qris_image ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set("qris_image", null)}
                  >
                    <Trash2 className="size-4" aria-hidden /> {t("Hapus gambar")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {demo
                  ? t("Unggah gambar dinonaktifkan di mode demo.")
                  : t("PNG/JPEG/WebP, otomatis dikecilkan (maks. 200 KB).")}
              </p>
            </div>
          )}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pm-holder">{t("Atas nama")}</Label>
            <Input
              id="pm-holder"
              maxLength={METHOD_LIMITS.account_holder}
              value={f.account_holder}
              onChange={(e) => set("account_holder", e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pm-acc">{t("Dompet tujuan (opsional, hanya untuk Anda)")}</Label>
            <Select
              value={f.account_id || NONE}
              onValueChange={(v) => set("account_id", v === NONE ? "" : v)}
            >
              <SelectTrigger id="pm-acc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Tidak ditautkan")}</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="pm-active">{t("Aktif")}</Label>
            <Switch id="pm-active" checked={f.active} onCheckedChange={(v) => set("active", v)} />
          </div>
          <DialogFooter className="col-span-2 gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Batal")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("Menyimpan…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
