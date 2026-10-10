import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImageUp, Settings2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAppSettingsFull, saveAppSettingsFn } from "@/lib/app-settings.functions";
import {
  DEFAULT_APP_NAME,
  DEFAULT_TAGLINE,
  LOGO_SIZE,
  TIMEZONES,
  isLogoDataUrl,
  type ResolvedSettings,
} from "@/lib/app-settings";
import { CURRENCIES, type Account } from "@/lib/schemas";
import { errMsg, invalidateFor, rowsQuery } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";

const NONE = "__none__";

type Form = {
  app_name: string;
  tagline: string;
  logo_data: string | null;
  timezone: string;
  base_currency: (typeof CURRENCIES)[number];
  landing_enabled: boolean;
  landing_tagline: string;
  github_url: string;
  bot_default_account_id: string;
  reminder_days: string;
};

function toForm(s: ResolvedSettings): Form {
  return {
    app_name: s.app_name === DEFAULT_APP_NAME ? "" : s.app_name,
    tagline: s.tagline === DEFAULT_TAGLINE ? "" : s.tagline,
    logo_data: s.logo_data,
    timezone: s.timezone,
    base_currency: s.base_currency,
    landing_enabled: s.landing_enabled,
    landing_tagline: s.landing_tagline ?? "",
    github_url: s.github_url ?? "",
    bot_default_account_id: s.bot_default_account_id ?? "",
    reminder_days: s.reminder_days == null ? "" : String(s.reminder_days),
  };
}

/** Resizes an image file to fit LOGO_SIZE (square canvas, centred) and returns a PNG data URL. */
async function resizeLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LOGO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    const scale = Math.min(LOGO_SIZE / img.naturalWidth, LOGO_SIZE / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (LOGO_SIZE - w) / 2, (LOGO_SIZE - h) / 2, w, h);
    const png = canvas.toDataURL("image/png");
    // Large photos can exceed the limit as PNG; WebP keeps them small.
    return isLogoDataUrl(png) ? png : canvas.toDataURL("image/webp", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Settings card "Aplikasi": branding, time zone, currency, landing page and bot defaults (v14). */
export function AppSettingsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const read = useServerFn(getAppSettingsFull);
  const save = useServerFn(saveAppSettingsFn);
  const q = useQuery({ queryKey: ["app-settings"], queryFn: () => read() });
  const accounts = ((useQuery(rowsQuery("accounts")).data ?? []) as Account[]).filter(
    (a) => !a.archived,
  );
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data && !form) setForm(toForm(q.data.settings));
  }, [q.data, form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("Pilih berkas gambar"));
      return;
    }
    try {
      const data = await resizeLogo(file);
      if (!isLogoDataUrl(data)) {
        toast.error(t("Logo terlalu besar (maks. 200 KB)"));
        return;
      }
      set("logo_data", data);
    } catch {
      toast.error(t("Gambar tidak bisa dibaca"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const res = await save({
        data: {
          ...form,
          reminder_days: form.reminder_days === "" ? null : Number(form.reminder_days),
          bot_default_account_id: form.bot_default_account_id || null,
        },
      });
      setForm(toForm(res.settings));
      await invalidateFor(qc, "app_settings");
      toast.success(t("Tersimpan"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const tzOptions =
    form && !(TIMEZONES as readonly string[]).includes(form.timezone)
      ? [form.timezone, ...TIMEZONES]
      : [...TIMEZONES];
  const env = q.data?.env;

  return (
    <Card className="mt-4 min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Settings2 className="size-4" /> {t("Aplikasi")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Nama, logo, zona waktu, halaman depan, dan default bot. Kosongkan untuk memakai default.",
        )}
      </p>
      {q.data && !q.data.ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t(
            "Jalankan bagian v14 di supabase/schema.sql untuk menyimpan pengaturan ini. Sampai saat itu nilai env dipakai.",
          )}
        </p>
      ) : null}
      {!form ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("Memuat…")}</p>
      ) : (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="as-name">{t("Nama aplikasi")}</Label>
            <Input
              id="as-name"
              maxLength={40}
              placeholder={DEFAULT_APP_NAME}
              value={form.app_name}
              onChange={(e) => set("app_name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-tagline">{t("Tagline")}</Label>
            <Input
              id="as-tagline"
              maxLength={80}
              placeholder={t(DEFAULT_TAGLINE)}
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("Logo")}</Label>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <img
                src={form.logo_data ?? "/logo.svg"}
                alt=""
                className="size-14 shrink-0 rounded-xl border object-contain"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  void pickLogo(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <ImageUp className="size-4" /> {t("Unggah logo")}
              </Button>
              {form.logo_data ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set("logo_data", null)}
                >
                  <Trash2 className="size-4" /> {t("Pakai logo bawaan")}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("PNG/JPEG/WebP, diperkecil otomatis ke 512 px (maks. 200 KB).")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="as-tz">{t("Zona waktu")}</Label>
            <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
              <SelectTrigger id="as-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tzOptions.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {env?.timezone ? (
              <p className="text-xs text-muted-foreground">
                {t("Env APP_TIMEZONE:")} <code>{env.timezone}</code>
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-cur">{t("Mata uang utama")}</Label>
            <Select
              value={form.base_currency}
              onValueChange={(v) => set("base_currency", v as Form["base_currency"])}
            >
              <SelectTrigger id="as-cur">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("Hanya preferensi tampilan; laporan tetap dihitung dalam IDR.")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="as-acc">{t("Akun default bot")}</Label>
            <Select
              value={form.bot_default_account_id || NONE}
              onValueChange={(v) => set("bot_default_account_id", v === NONE ? "" : v)}
            >
              <SelectTrigger id="as-acc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {env?.bot_default_account
                    ? `${t("Dari env")} (${env.bot_default_account})`
                    : t("Tidak ada")}
                </SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-days">{t("Hari pengingat default")}</Label>
            <Input
              id="as-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              placeholder={t("bot 14 · n8n 7")}
              value={form.reminder_days}
              onChange={(e) => set("reminder_days", e.target.value)}
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 sm:col-span-2">
            <span className="text-sm font-medium">{t("Tampilkan halaman depan (landing)")}</span>
            <Switch
              checked={form.landing_enabled}
              onCheckedChange={(c) => set("landing_enabled", c)}
            />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="as-ltag">{t("Tagline halaman depan")}</Label>
            <Input
              id="as-ltag"
              maxLength={160}
              value={form.landing_tagline}
              onChange={(e) => set("landing_tagline", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-gh">{t("URL GitHub")}</Label>
            <Input
              id="as-gh"
              type="url"
              maxLength={200}
              placeholder="https://github.com/…"
              value={form.github_url}
              onChange={(e) => set("github_url", e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || q.data?.ready === false}>
              {busy ? t("Menyimpan…") : t("Simpan")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
