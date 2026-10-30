import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { deleteNotifySettingsFn, saveNotifySettingsFn } from "@/lib/notify.functions";
import { chatIdProblem, normalizeChatId } from "@/lib/notify";
import { errMsg, invalidateFor, notifyQueryKey } from "@/lib/queries";
import { displayNameOf } from "@/lib/users";
import { useI18n } from "@/lib/i18n";
import type { Account } from "@/lib/schemas";

export type NotifyEntry = {
  user_id: string;
  chat_id: string;
  enabled: boolean;
  send_report: boolean;
  send_reminders: boolean;
  wallets: string[];
};

type Member = {
  id: string | null;
  username: string;
  display_name: string | null;
  grants: { account_id: string; level: string }[];
};

/**
 * Settings → Pengguna → Notifikasi (v22, admin only): Telegram chat id (private or group) of one
 * member for scheduled reports & reminders, plus an optional wallet checklist limited to the
 * wallets the member may view. Separate from BOT_ALLOWED_CHAT_IDS (no bot access).
 */
export function NotifyDialog({
  user,
  accounts,
  current,
  onOpenChange,
}: {
  user: Member;
  accounts: Account[];
  current: NotifyEntry | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(saveNotifySettingsFn);
  const del = useServerFn(deleteNotifySettingsFn);
  const viewable = accounts.filter((a) => user.grants.some((g) => g.account_id === a.id));
  const [chatId, setChatId] = useState(current?.chat_id ?? "");
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [report, setReport] = useState(current?.send_report ?? true);
  const [reminders, setReminders] = useState(current?.send_reminders ?? true);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set((current?.wallets ?? []).filter((id) => viewable.some((a) => a.id === id))),
  );
  const [busy, setBusy] = useState(false);
  const problem = chatId ? chatIdProblem(chatId) : null;
  const canSubmit = !busy && !!user.id && !!normalizeChatId(chatId);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: notifyQueryKey });
    await invalidateFor(qc, "notify_recipients");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !user.id) return;
    setBusy(true);
    try {
      await save({
        data: {
          user_id: user.id,
          chat_id: chatId.trim(),
          enabled,
          send_report: report,
          send_reminders: reminders,
          wallets: [...picked],
        },
      });
      toast.success(t("Tersimpan"));
      onOpenChange(false);
      await refresh();
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!user.id) return;
    setBusy(true);
    try {
      await del({ data: { user_id: user.id } });
      toast.success(t("Dihapus"));
      onOpenChange(false);
      await refresh();
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
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Notifikasi Telegram")} · {displayNameOf(user)}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Laporan & pengingat terjadwal (n8n) hanya berisi dompet yang boleh dilihat anggota ini. Chat ID ini tidak memberi akses ke bot.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="n-chat">{t("Chat ID Telegram")}</Label>
            <Input
              id="n-chat"
              inputMode="numeric"
              autoComplete="off"
              value={chatId}
              maxLength={21}
              placeholder="123456789"
              onChange={(e) => setChatId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("Chat pribadi atau grup (ID grup diawali tanda minus, mis. -100…).")}
            </p>
            {problem ? <p className="text-xs text-expense">{t(problem)}</p> : null}
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              {t("Aktif")}
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("Aktif")} />
            </label>
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
            {viewable.length ? (
              <ul className="divide-y rounded-lg border">
                {viewable.map((a) => (
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
                {t("Anggota ini belum punya akses dompet, jadi tidak akan menerima notifikasi.")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("Tidak ada yang dicentang = semua dompet yang boleh dilihat anggota.")}
            </p>
          </fieldset>
          <DialogFooter className="gap-2 sm:justify-between">
            {current ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
                {t("Hapus notifikasi")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!canSubmit}>
              {busy ? t("Menyimpan…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
