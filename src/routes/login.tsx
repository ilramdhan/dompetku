import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { login } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { AppLogo, AppName, useTagline } from "@/components/app-logo";
import { useDemoInfo } from "@/components/demo";
import { FlaskConical, LogIn } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => pageHead("Masuk", "Masuk ke Dompetku — pelacak keuangan pribadi."),
  beforeLoad: async () => {
    const { getSession } = await import("@/lib/auth.functions");
    const { clearSessionCache } = await import("@/lib/session-cache");
    // Reaching /login (logout, expired session) always drops the cached check.
    clearSessionCache();
    const s = await getSession();
    if (s.authenticated) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const tagline = useTagline();
  const run = useServerFn(login);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const demo = useDemoInfo();

  async function submitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await signIn(String(fd.get("username") ?? ""), String(fd.get("password") ?? ""));
  }

  async function signIn(username: string, password: string) {
    setBusy(true);
    try {
      const res = await run({ data: { username, password } });
      if (res.ok) {
        window.location.href = "/dashboard";
        return;
      }
      if ("needTotp" in res && res.needTotp) {
        setChallenge(res.challenge);
        setCode("");
      } else {
        toast.error(
          res.locked
            ? t("Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam 15 menit.")
            : t("Username atau password salah"),
        );
      }
      setBusy(false);
    } catch {
      toast.error(t("Username atau password salah"));
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    try {
      const res = await run({ data: { challenge, code } });
      if (res.ok) {
        window.location.href = "/dashboard";
        return;
      }
      if (res.locked) {
        toast.error(t("Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam 15 menit."));
        setChallenge(null);
      } else if ("expired" in res && res.expired) {
        toast.error(t("Sesi verifikasi kedaluwarsa. Silakan masuk lagi."));
        setChallenge(null);
      } else {
        toast.error(t("Kode verifikasi salah atau sudah dipakai"));
        setCode("");
      }
      setBusy(false);
    } catch {
      toast.error(t("Kode verifikasi salah atau sudah dipakai"));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-sidebar px-4 py-8">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <p className="flex items-center gap-3 font-display text-3xl font-bold">
          <AppLogo className="size-10" />
          <AppName className="min-w-0 truncate" />
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{tagline}</p>
        {demo.demo && !challenge ? (
          <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="flex items-start gap-2 font-medium">
              <FlaskConical className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {t("Ini instance demo — data palsu, direset setiap hari 00:00 WIB")}
            </p>
            <Button
              type="button"
              className="mt-3 w-full"
              disabled={busy}
              onClick={() => void signIn(demo.username, demo.password)}
            >
              <LogIn className="size-4" /> {busy ? t("Memeriksa…") : t("Masuk ke demo")}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("Atau masuk manual dengan kredensial demo di bawah.")}
            </p>
          </div>
        ) : null}
        {challenge ? (
          <form className="mt-6 space-y-4" onSubmit={submitCode}>
            <div className="space-y-1.5">
              <Label htmlFor="code">{t("Kode verifikasi")}</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))}
                className="num text-center text-lg tracking-[0.3em]"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t("Masukkan 6 digit kode dari aplikasi authenticator Anda.")}
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || code.replace(/\s/g, "").length !== 6}
            >
              {busy ? t("Memeriksa…") : t("Verifikasi")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() => setChallenge(null)}
            >
              {t("Kembali")}
            </Button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submitPassword}>
            <div className="space-y-1.5">
              <Label htmlFor="username">{t("Username")}</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                required
                autoFocus={!demo.demo}
                key={demo.demo ? "demo" : "normal"}
                defaultValue={demo.demo ? demo.username : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("Password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                key={demo.demo ? "demo" : "normal"}
                defaultValue={demo.demo ? demo.password : undefined}
              />
            </div>
            <Button
              type="submit"
              variant={demo.demo ? "outline" : "default"}
              className="w-full"
              disabled={busy}
            >
              {busy ? t("Memeriksa…") : t("Masuk")}
            </Button>
          </form>
        )}
      </Card>
      <Link
        to="/"
        className="mt-4 rounded-sm text-sm text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        ← {t("Kembali ke beranda")}
      </Link>
    </main>
  );
}
