import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { BellRing } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveMyNotifyFn } from "@/lib/notify.functions";
import { normalizeChatId } from "@/lib/notify";
import { errMsg, invalidateFor, myNotifyQuery } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";

/**
 * Profile → Notifikasi Telegram (#122, members only): the member's own chat id for scheduled
 * reports & reminders (workflow 06), toggles and an optional checklist of the wallets they may
 * view. Empty chat id = stop receiving. Never grants bot access (BOT_ALLOWED_CHAT_IDS is separate).
 */
export function MyNotifyCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery(myNotifyQuery());
  const save = useServerFn(saveMyNotifyFn);
  const [chatId, setChatId] = useState("");
  const [report, setReport] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setChatId(q.data.chat_id);
    setReport(q.data.send_report);
    setReminders(q.data.send_reminders);
    setPicked(new Set(q.data.wallets));
  }, [q.data]);

  const d = q.data;
  const problem =
    chatId.trim() && !normalizeChatId(chatId)
      ? "Chat ID harus berupa angka (grup diawali tanda minus)"
      : null;
  const canSubmit = !!d?.ready && !busy && !problem;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await save({
        data: {
          chat_id: chatId.trim(),
          send_report: report,
          send_reminders: reminders,
          wallets: [...picked],
        },
      });
      toast.success(chatId.trim() ? t("Tersimpan") : t("Notifikasi Telegram dimatikan"));
      await invalidateFor(qc, "notify_recipients");
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Card className="min-w-0 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <BellRing className="size-4" /> {t("Notifikasi Telegram")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Laporan & pengingat terjadwal hanya berisi dompet yang boleh Anda lihat. Chat ID ini tidak memberi akses ke bot.",
        )}
      </p>
      {q.isError ? <p className="mt-3 text-sm text-destructive">{t(errMsg(q.error))}</p> : null}
      {!d ? (
        q.isError ? null : (
          <p className="mt-3 text-sm text-muted-foreground">{t("Memuat…")}</p>
        )
      ) : !d.ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("Notifikasi per anggota belum aktif. Minta admin menjalankan bagian v22.")}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          {!d.enabled && d.chat_id ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {t("Admin menonaktifkan notifikasi Anda. Hubungi admin untuk mengaktifkannya lagi.")}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="my-chat">{t("Chat ID Telegram")}</Label>
            <Input
              id="my-chat"
              inputMode="numeric"
              autoComplete="off"
              value={chatId}
              maxLength={21}
              placeholder="123456789"
              onChange={(e) => setChatId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Mulai chat dengan bot dulu (atau tambahkan bot ke grup). Kosongkan untuk berhenti menerima notifikasi.",
              )}
            </p>
            {problem ? <p className="text-xs text-expense">{t(problem)}</p> : null}
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              {t("Laporan terjadwal")}
              <Switch
                checked={report}
                onCheckedChange={setReport}
                aria-label={t("Laporan terjadwal")}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t("Pengingat tagihan")}
              <Switch
                checked={reminders}
                onCheckedChange={setReminders}
                aria-label={t("Pengingat tagihan")}
              />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t("Dompet di notifikasi")}</legend>
            {d.options.length ? (
              <ul className="divide-y rounded-lg border">
                {d.options.map((a) => (
                  <li key={a.id} className="min-w-0">
                    <label className="flex min-w-0 cursor-pointer items-center gap-3 p-2.5">
                      <Checkbox
                        checked={picked.has(a.id)}
                        onCheckedChange={(v) => toggle(a.id, v === true)}
                      />
                      <span className="min-w-0 truncate text-sm">{a.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("Anda belum punya akses dompet, jadi belum ada notifikasi yang dikirim.")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("Tidak ada yang dicentang = semua dompet yang boleh Anda lihat.")}
            </p>
          </fieldset>
          <Button type="submit" disabled={!canSubmit}>
            {busy ? t("Menyimpan…") : t("Simpan")}
          </Button>
        </form>
      )}
    </Card>
  );
}
