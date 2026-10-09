import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, ImageUp, KeyRound, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { DemoDisabled } from "@/components/demo";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changePassword, updateProfile } from "@/lib/profile.functions";
import { AVATAR_SIZE, isAvatarDataUrl, type Profile } from "@/lib/profile";
import { PASSWORD_MAX, passwordProblems, passwordStrength } from "@/lib/password";
import { errMsg, invalidateFor, profileQuery } from "@/lib/queries";
import { clearSessionCache } from "@/lib/session-cache";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/profile")({
  head: () => pageHead("Profil", "Nama, alamat, foto profil, dan password."),
  errorComponent: RouteError,
  component: ProfilePage,
});

/** Center-crops an image to a square, scales it to AVATAR_SIZE and returns a WebP/JPEG data URL. */
async function resizeAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    const webp = canvas.toDataURL("image/webp", 0.85);
    // Safari < 17 can't encode WebP and silently returns PNG; fall back to JPEG then.
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfilePage() {
  const { t } = useI18n();
  const q = useQuery(profileQuery());
  return (
    <>
      <PageHeader title={t("Profil")} subtitle={t("Nama, alamat, foto profil, dan password.")} />
      {q.data && !q.data.ready ? (
        <p className="mb-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t(
            "Jalankan bagian v17 di supabase/schema.sql untuk mengubah profil dan password. Sampai saat itu login tetap memakai APP_USERNAME/APP_PASSWORD dari env.",
          )}
        </p>
      ) : null}
      {q.isError ? <p className="text-sm text-destructive">{errMsg(q.error)}</p> : null}
      {!q.data ? (
        q.isError ? null : (
          <p className="text-sm text-muted-foreground">{t("Memuat…")}</p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DemoDisabled>
            <ProfileCard profile={q.data.profile} ready={q.data.ready} />
          </DemoDisabled>
          <DemoDisabled>
            <PasswordCard
              username={q.data.profile.username}
              ready={q.data.ready}
              hasDbPassword={q.data.has_db_password}
              resetMode={q.data.reset_mode}
            />
          </DemoDisabled>
        </div>
      )}
    </>
  );
}

function ProfileCard({ profile, ready }: { profile: Profile; ready: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(updateProfile);
  const [form, setForm] = useState({
    display_name: profile.display_name ?? "",
    address: profile.address ?? "",
    avatar: profile.avatar,
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm({
      display_name: profile.display_name ?? "",
      address: profile.address ?? "",
      avatar: profile.avatar,
    });
  }, [profile]);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("Pilih berkas gambar"));
      return;
    }
    try {
      const data = await resizeAvatar(file);
      if (!isAvatarDataUrl(data)) {
        toast.error(t("Foto terlalu besar (maks. 200 KB)"));
        return;
      }
      setForm((f) => ({ ...f, avatar: data }));
    } catch {
      toast.error(t("Gambar tidak bisa dibaca"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await save({ data: form });
      qc.setQueryData(profileQuery().queryKey, res);
      await invalidateFor(qc, "app_users");
      toast.success(t("Tersimpan"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <UserRound className="size-4" /> {t("Data diri")}
      </h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <UserAvatar
            src={form.avatar}
            name={form.display_name}
            username={profile.username}
            className="size-16 text-lg"
          />
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
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <ImageUp className="size-4" /> {t("Unggah foto")}
            </Button>
            {form.avatar ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, avatar: null }))}
              >
                <Trash2 className="size-4" /> {t("Hapus foto")}
              </Button>
            ) : null}
          </div>
          <p className="w-full text-xs text-muted-foreground">
            {t("PNG/JPEG/WebP, dipotong persegi dan diperkecil otomatis (maks. 200 KB).")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-user">{t("Username")}</Label>
          <Input id="pf-user" value={profile.username} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            {t("Username diatur lewat env APP_USERNAME.")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-name">{t("Nama")}</Label>
          <Input
            id="pf-name"
            maxLength={80}
            autoComplete="name"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-addr">{t("Alamat")}</Label>
          <Textarea
            id="pf-addr"
            maxLength={300}
            rows={3}
            autoComplete="street-address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </div>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? t("Menyimpan…") : t("Simpan")}
        </Button>
      </form>
    </Card>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX}
        className="pr-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute inset-y-0 right-0 h-full w-10"
        aria-label={show ? t("Sembunyikan password") : t("Tampilkan password")}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

const STRENGTH = ["Sangat lemah", "Lemah", "Cukup", "Kuat", "Sangat kuat"];

function PasswordCard({
  username,
  ready,
  hasDbPassword,
  resetMode,
}: {
  username: string;
  ready: boolean;
  hasDbPassword: boolean;
  resetMode: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const change = useServerFn(changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(next);
  const problems = next ? passwordProblems(next, { username, current: current || null }) : [];
  const mismatch = confirm !== "" && confirm !== next;
  const canSubmit =
    ready && !busy && current !== "" && next !== "" && !problems.length && confirm === next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await change({ data: { current, next } });
      if (!res.ok) {
        toast.error(t(res.error));
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("Password diganti. Perangkat lain sudah dikeluarkan."));
      await invalidateFor(qc, "app_users");
    } catch (err) {
      const m = errMsg(err);
      if (m === "Unauthorized") {
        clearSessionCache();
        await router.invalidate();
        await navigate({ to: "/login" });
        return;
      }
      toast.error(t(m));
    } finally {
      setBusy(false);
    }
  }

  const bar = ["bg-expense", "bg-expense", "bg-warning", "bg-income", "bg-income"];

  return (
    <Card className="min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <KeyRound className="size-4" /> {t("Ganti password")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasDbPassword
          ? t("Password disimpan sebagai hash di database; APP_PASSWORD di env tidak lagi dipakai.")
          : t(
              "Saat ini login memakai APP_PASSWORD dari env. Setelah diganti, password baru disimpan sebagai hash di database.",
            )}
      </p>
      {resetMode ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t(
            "APP_PASSWORD_RESET=true aktif: password dari env dipakai. Ganti password lalu hapus variabel itu dan deploy ulang.",
          )}
        </p>
      ) : null}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          hidden
        />
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">{t("Password saat ini")}</Label>
          <PasswordInput
            id="pw-current"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next">{t("Password baru")}</Label>
          <PasswordInput id="pw-next" autoComplete="new-password" value={next} onChange={setNext} />
          {next ? (
            <div className="space-y-2 pt-1" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      i < Math.max(1, strength.score) ? bar[strength.score] : "bg-muted",
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("Kekuatan:")}{" "}
                <span className="font-medium text-foreground">{t(STRENGTH[strength.score]!)}</span>
              </p>
            </div>
          ) : null}
          <ul className="grid grid-cols-1 gap-1 pt-1 text-xs sm:grid-cols-2">
            {strength.hints.map((h) => (
              <li
                key={h.key}
                className={cn(
                  "flex items-center gap-1.5",
                  h.ok ? "text-income" : "text-muted-foreground",
                )}
              >
                {h.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {t(h.key)}
              </li>
            ))}
          </ul>
          {problems.length ? (
            <ul className="space-y-0.5 text-xs text-expense">
              {problems.map((p) => (
                <li key={p}>{t(p)}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">{t("Ulangi password baru")}</Label>
          <PasswordInput
            id="pw-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
          {mismatch ? <p className="text-xs text-expense">{t("Password tidak sama")}</p> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Setelah diganti, semua perangkat lain otomatis keluar.")}
        </p>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? t("Menyimpan…") : t("Ganti password")}
        </Button>
      </form>
    </Card>
  );
}
