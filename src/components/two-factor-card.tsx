import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { generateTwoFactorSecret, getTwoFactorStatus } from "@/lib/auth.functions";
import { formatSecret } from "@/lib/totp";
import { useI18n } from "@/lib/i18n";

/** Settings card: shows 2FA status and helps enroll a new APP_TOTP_SECRET. */
export function TwoFactorCard() {
  const { t } = useI18n();
  const status = useServerFn(getTwoFactorStatus);
  const generate = useServerFn(generateTwoFactorSecret);
  const q = useQuery({ queryKey: ["two-factor-status"], queryFn: () => status() });
  const [draft, setDraft] = useState<{ secret: string; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function makeSecret() {
    setBusy(true);
    try {
      setDraft(await generate());
    } catch {
      toast.error(t("Gagal membuat kunci rahasia"));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Disalin"));
    } catch {
      toast.error(t("Gagal menyalin"));
    }
  }

  const active = q.data?.active === true;

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="flex min-w-0 items-start gap-3">
        {active ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        ) : (
          <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("Verifikasi dua langkah (2FA)")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.isLoading
              ? t("Memeriksa…")
              : active
                ? t("Aktif — login meminta kode 6 digit dari aplikasi authenticator.")
                : t("Belum aktif — login hanya memakai username dan password.")}
          </p>
          {q.data?.invalid ? (
            <p className="mt-1 text-sm text-destructive">
              {t("APP_TOTP_SECRET tidak valid sehingga diabaikan. Buat kunci baru di bawah.")}
            </p>
          ) : null}
        </div>
      </div>

      {active ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            "Untuk menonaktifkan atau mengganti perangkat, hapus/ubah APP_TOTP_SECRET di Vercel lalu redeploy.",
          )}
        </p>
      ) : q.data ? (
        <div className="mt-4 space-y-3">
          {!draft ? (
            <Button onClick={makeSecret} disabled={busy}>
              {busy ? t("Membuat…") : t("Buat kunci rahasia")}
            </Button>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>
                  {t(
                    "Di Google Authenticator / Aegis, pilih tambah akun → masukkan kunci secara manual (berbasis waktu).",
                  )}
                </li>
                <li>
                  {t("Tambahkan kunci ini sebagai APP_TOTP_SECRET di Vercel, lalu redeploy.")}
                </li>
                <li>{t("Setelah redeploy, login akan meminta kode 6 digit.")}</li>
              </ol>
              <div className="min-w-0 rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">{t("Kunci rahasia")}</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <code className="num min-w-0 flex-1 break-all text-sm font-semibold">
                    {formatSecret(draft.secret)}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Salin")}
                    onClick={() => copy(draft.secret)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-w-0 rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">
                  {t("URI otpauth (untuk aplikasi yang mendukung impor tautan)")}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <code className="num min-w-0 flex-1 break-all text-xs">{draft.uri}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Salin")}
                    onClick={() => copy(draft.uri)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Kunci ini hanya ditampilkan sekarang dan tidak disimpan. Simpan cadangannya di tempat aman.",
                )}
              </p>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
