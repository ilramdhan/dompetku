import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bot,
  Link2,
  Link2Off,
  Mail,
  PlugZap,
  Sparkles,
  Workflow,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-dialog";
import {
  deleteTelegramWebhook,
  getIntegrationSettings,
  removeIntegrationFn,
  saveIntegrationFn,
  setTelegramWebhook,
  telegramStatus,
  testAiConnection,
} from "@/lib/integrations.functions";
import {
  INTEGRATION_GROUPS,
  integrationDef,
  validateIntegration,
  type IntegrationGroup,
  type IntegrationStatus,
} from "@/lib/integrations";
import { errMsg } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const GROUP: Record<IntegrationGroup, { title: string; icon: typeof Bot }> = {
  telegram: { title: "Bot Telegram", icon: Bot },
  ai: { title: "AI (OCR & parsing chat)", icon: Sparkles },
  email: { title: "Email (Resend)", icon: Mail },
  n8n: { title: "n8n", icon: Workflow },
};

const QK = ["integration-settings"] as const;

function SourceBadge({ s }: { s: IntegrationStatus }) {
  const { t } = useI18n();
  const label =
    s.source === "db"
      ? t("Database")
      : s.source === "env"
        ? t("Env")
        : s.source === "default"
          ? t("Default")
          : t("Belum diatur");
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
        s.source === "db" && "border-transparent bg-primary text-primary-foreground",
        s.source === "env" && "border-transparent bg-secondary text-secondary-foreground",
        (s.source === "none" || s.source === "default") && "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function Field({
  s,
  disabled,
  onSaved,
}: {
  s: IntegrationStatus;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const def = integrationDef(s.key);
  const save = useServerFn(saveIntegrationFn);
  const remove = useServerFn(removeIntegrationFn);
  const [value, setValue] = useState(s.secret ? "" : s.source === "db" ? (s.value ?? "") : "");
  const [busy, setBusy] = useState(false);
  const ask = useConfirm();
  const id = `int-${s.key}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateIntegration(s.key, value);
    if (!v.ok) {
      toast.error(t(v.error));
      return;
    }
    setBusy(true);
    try {
      await save({ data: { key: s.key, value } });
      if (s.secret) setValue("");
      await onSaved();
      toast.success(t("Tersimpan"));
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    const ok = await ask.confirm(t("Hapus nilai dari database?"), {
      description: t("Aplikasi akan kembali memakai env var (jika ada)."),
      confirmLabel: t("Hapus"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await remove({ data: { key: s.key } });
      setValue("");
      await onSaved();
      toast.success(t("Dihapus — memakai env bila ada"));
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  const current = s.secret ? s.hint : s.source === "env" || s.source === "default" ? s.value : null;

  return (
    <form onSubmit={submit} className="min-w-0 space-y-1.5 rounded-xl border p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="min-w-0">
          {t(def.label)} <code className="ml-1 text-[11px] text-muted-foreground">{s.key}</code>
        </Label>
        <SourceBadge s={s} />
      </div>
      {s.problem ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-expense">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {s.problem === "decrypt"
            ? t(
                "Nilai tersimpan tidak bisa didekripsi (kunci berubah) — masukkan ulang. Sementara memakai env.",
              )
            : t("Nilai tersimpan tidak valid — sementara memakai env.")}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          className="min-w-0 flex-1"
          type={s.secret ? "password" : "text"}
          autoComplete={s.secret ? "new-password" : "off"}
          spellCheck={false}
          maxLength={4000}
          disabled={disabled || busy}
          placeholder={
            s.secret && s.set
              ? t("Tersimpan — ketik untuk mengganti")
              : (current ?? def.placeholder ?? "")
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex shrink-0 gap-2">
          <Button type="submit" size="sm" disabled={disabled || busy || !value.trim()}>
            {s.secret && s.stored ? t("Ganti") : t("Simpan")}
          </Button>
          {s.stored ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void doRemove()}
            >
              {t("Hapus")}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(def.help)}
        {current ? (
          <>
            {" · "}
            {s.secret ? t("Aktif:") : t("Nilai aktif:")}{" "}
            <code className="break-all">{current}</code>
          </>
        ) : null}
      </p>
      {ask.element}
    </form>
  );
}

function AiTest({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const test = useServerFn(testAiConnection);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await test();
      if (r.ok) toast.success(`${t("Koneksi AI berhasil")} (${r.message})`);
      else toast.error(`${t("Koneksi AI gagal")}: ${t(r.message)}`);
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={run}>
      <PlugZap className="size-4" /> {busy ? t("Menguji…") : t("Tes koneksi")}
    </Button>
  );
}

function TelegramDirect({ disabled, configured }: { disabled: boolean; configured: boolean }) {
  const { t } = useI18n();
  const status = useServerFn(telegramStatus);
  const setHook = useServerFn(setTelegramWebhook);
  const delHook = useServerFn(deleteTelegramWebhook);
  const q = useQuery({
    queryKey: [...QK, "telegram", configured],
    queryFn: () => status(),
    enabled: configured,
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState(false);
  if (!configured)
    return (
      <p className="text-xs text-muted-foreground">
        {t(
          "Mode langsung (tanpa n8n): isi token bot di atas, lalu pasang webhook. Alur n8n tetap berjalan seperti biasa.",
        )}
      </p>
    );
  const d = q.data;
  const ours =
    d?.configured && d.webhook?.url
      ? d.webhook.url.endsWith("/api/public/telegram/webhook")
      : false;

  async function act(kind: "set" | "delete") {
    setBusy(true);
    try {
      if (kind === "set") await setHook({ data: { origin: window.location.origin } });
      else await delHook();
      await q.refetch();
      toast.success(kind === "set" ? t("Webhook dipasang") : t("Webhook dilepas"));
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3 text-sm">
      <p className="font-medium">{t("Mode langsung (webhook Telegram)")}</p>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("Memeriksa…")}</p>
      ) : d?.configured ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {d.ok ? (
              <>
                {t("Bot:")} <span className="font-medium text-foreground">@{d.username}</span>
              </>
            ) : (
              <span className="text-expense">
                {t("Token ditolak Telegram")}: {d.error}
              </span>
            )}
          </p>
          <p className="break-all">
            {t("Webhook:")}{" "}
            {d.webhook?.url ? <code>{d.webhook.url}</code> : t("belum dipasang (n8n / polling)")}
          </p>
          {d.webhook?.url && !ours ? (
            <p>
              {t(
                "Webhook saat ini milik n8n atau layanan lain; memasang webhook di sini akan menggantikannya.",
              )}
            </p>
          ) : null}
          {d.webhook?.lastError ? (
            <p className="text-expense">
              {t("Error terakhir:")} {d.webhook.lastError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || busy || !(d?.configured && d.ok)}
          onClick={() => act("set")}
        >
          <Link2 className="size-4" /> {t("Pasang webhook")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy || !ours}
          onClick={() => act("delete")}
        >
          <Link2Off className="size-4" /> {t("Lepas webhook")}
        </Button>
      </div>
    </div>
  );
}

/** Settings card "Integrasi" (v16): bot, AI, email and n8n values stored in the DB over env. */
export function IntegrationsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const read = useServerFn(getIntegrationSettings);
  const q = useQuery({ queryKey: QK, queryFn: () => read() });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QK });
  };
  const data = q.data;
  const disabled = !data || !data.ready;

  return (
    <Card className="mt-4 min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <PlugZap className="size-4" /> {t("Integrasi")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Atur bot, AI, email, dan n8n tanpa mengubah env atau redeploy. Nilai di sini menang atas env; hapus untuk kembali ke env. Rahasia disimpan terenkripsi dan tidak pernah ditampilkan lagi.",
        )}
      </p>
      {data && !data.ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t(
            "Jalankan bagian v16 di supabase/schema.sql untuk menyimpan pengaturan ini. Sampai saat itu nilai env dipakai.",
          )}
        </p>
      ) : null}
      {data && !data.canEncrypt ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-expense">
          {t("SESSION_SECRET (≥ 32 karakter) dibutuhkan untuk menyimpan rahasia.")}
        </p>
      ) : null}
      {!data ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {q.isError ? t(errMsg(q.error)) : t("Memuat…")}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {INTEGRATION_GROUPS.map((g) => {
            const G = GROUP[g];
            const items = data.items.filter((i) => i.group === g);
            const token = data.items.find((i) => i.key === "TELEGRAM_BOT_TOKEN");
            return (
              <section key={g} className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <G.icon className="size-4" aria-hidden="true" /> {t(G.title)}
                  </h3>
                  {g === "ai" ? <AiTest disabled={disabled} /> : null}
                </div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {items.map((s) => (
                    <Field
                      key={`${s.key}:${s.updated_at ?? ""}:${s.source}`}
                      s={s}
                      disabled={disabled || (s.secret && !data.canEncrypt)}
                      onSaved={refresh}
                    />
                  ))}
                </div>
                {g === "telegram" ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t("Akun default bot diatur di kartu Aplikasi.")}
                    </p>
                    <TelegramDirect disabled={disabled} configured={!!token?.set} />
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
