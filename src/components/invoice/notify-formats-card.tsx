import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteNotifyFormatFn, saveNotifyFormatFn } from "@/lib/payment-signals.functions";
import { errMsg, invalidateFor, notifyFormatsQuery, rowsQuery } from "@/lib/queries";
import {
  DEFAULT_AMOUNT_REGEX,
  NOTIFY_LIMITS,
  NOTIFY_PRESETS,
  formatProblems,
  parseNotification,
  type MatchMode,
  type NotifyFormat,
} from "@/lib/bank-notify";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Account } from "@/lib/schemas";

type Row = NotifyFormat & { id: string };
type Data = {
  ready: boolean;
  formats: Row[];
  configured: boolean;
  auto_confirm: boolean;
  generic: boolean;
};
type Form = Omit<
  NotifyFormat,
  | "id"
  | "app_match"
  | "title_match"
  | "text_match"
  | "must_contain"
  | "ignore_contains"
  | "account_id"
> & {
  id: string | null;
  app_match: string;
  title_match: string;
  text_match: string;
  must_contain: string;
  ignore_contains: string;
  account_id: string;
};

const NONE = "__none";

const toForm = (f: Partial<NotifyFormat> & { id?: string | null }): Form => ({
  id: f.id ?? null,
  name: f.name ?? "",
  app_match: f.app_match ?? "",
  title_match: f.title_match ?? "",
  text_match: f.text_match ?? "",
  match_mode: f.match_mode === "regex" ? "regex" : "contains",
  amount_regex: f.amount_regex ?? DEFAULT_AMOUNT_REGEX,
  must_contain: f.must_contain ?? "",
  ignore_contains: f.ignore_contains ?? "",
  account_id: f.account_id ?? "",
  enabled: f.enabled !== false,
});

const fromForm = (f: Form): NotifyFormat => ({
  name: f.name,
  app_match: f.app_match || null,
  title_match: f.title_match || null,
  text_match: f.text_match || null,
  match_mode: f.match_mode,
  amount_regex: f.amount_regex,
  must_contain: f.must_contain || null,
  ignore_contains: f.ignore_contains || null,
  account_id: f.account_id || null,
  enabled: f.enabled,
});

/**
 * Settings → Format notifikasi bank (v26, issue #96, admin only): which bank / e-wallet
 * notifications forwarded by MacroDroid count as incoming money and how the amount is read.
 * Presets are editable examples. "Uji teks contoh" runs the same pure parser as the server, in the
 * browser, on a pasted notification.
 */
export function NotifyFormatsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const ask = useConfirm();
  const q = useQuery(notifyFormatsQuery());
  const save = useServerFn(saveNotifyFormatFn);
  const del = useServerFn(deleteNotifyFormatFn);
  const accounts = ((useQuery(rowsQuery("accounts")).data ?? []) as Account[]).filter(
    (a) => !a.archived,
  );
  const [form, setForm] = useState<Form | null>(null);
  const [preset, setPreset] = useState("");
  const data = q.data as Data | undefined;
  const ready = data?.ready ?? false;

  async function addPreset(key: string) {
    const p = NOTIFY_PRESETS.find((x) => x.key === key);
    if (!p) return;
    try {
      const { key: _k, ...values } = p;
      await save({ data: { id: null, values: { ...values, account_id: null } } });
      await invalidateFor(qc, "payment_notify_formats");
      toast.success(t("Contoh format ditambahkan, sesuaikan dengan notifikasi Anda"));
      setPreset("");
    } catch (e) {
      toast.error(t("Gagal menyimpan"), { description: t(errMsg(e)) });
    }
  }

  async function remove(f: Row) {
    const ok = await ask.confirm(`${t("Hapus ")}${f.name}${t("?")}`, {
      confirmLabel: t("Ya, hapus"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del({ data: { id: f.id } });
      await invalidateFor(qc, "payment_notify_formats");
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
            <BellRing className="size-4" aria-hidden /> {t("Format notifikasi bank")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Notifikasi uang masuk yang diteruskan MacroDroid dicocokkan dengan invoice terbuka (sisa tagihan + kode unik).",
            )}
          </p>
        </div>
        {ready ? (
          <Button onClick={() => setForm(toForm({}))}>
            <Plus className="size-4" aria-hidden /> {t("Tambah format")}
          </Button>
        ) : null}
      </div>
      {q.isError ? <p className="mt-3 text-sm text-destructive">{t(errMsg(q.error))}</p> : null}
      {data && !ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("Notifikasi bank belum aktif: jalankan bagian v26 di supabase/schema.sql.")}
        </p>
      ) : null}
      {ready ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant={data!.configured ? "default" : "outline"}>
              {data!.configured ? t("Token perangkat aktif") : t("Token perangkat belum diatur")}
            </Badge>
            <Badge variant="outline">
              {data!.auto_confirm ? t("Konfirmasi otomatis: aktif") : t("Konfirmasi manual")}
            </Badge>
            {data!.generic ? <Badge variant="outline">{t("Format generik aktif")}</Badge> : null}
          </div>
          {!data!.configured ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Isi MACRODROID_TOKEN di Integrasi → Notifikasi bank (MacroDroid). Panduan: docs/MACRODROID.md.",
              )}
            </p>
          ) : null}
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="min-w-0 sm:w-72" aria-label={t("Contoh format")}>
                <SelectValue placeholder={t("Pilih contoh format…")} />
              </SelectTrigger>
              <SelectContent>
                {NOTIFY_PRESETS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {t(p.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!preset} onClick={() => void addPreset(preset)}>
              <Plus className="size-4" aria-hidden /> {t("Tambah contoh")}
            </Button>
          </div>
          {data!.formats.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("Belum ada format notifikasi.")}
            </p>
          ) : (
            <ul className="mt-3 divide-y rounded-lg border">
              {data!.formats.map((f) => (
                <li
                  key={f.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2 font-medium">
                      <span className="truncate">{t(f.name)}</span>
                      {!f.enabled ? <Badge variant="outline">{t("Nonaktif")}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.app_match ? `${t("Aplikasi")}: ${f.app_match}` : t("Semua aplikasi")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9"
                      aria-label={t("Ubah")}
                      onClick={() => setForm(toForm(f))}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 text-expense"
                      aria-label={t("Hapus")}
                      onClick={() => void remove(f)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <SampleTester formats={data!.formats} generic={data!.generic} />
        </>
      ) : null}
      {form ? <FormatDialog form={form} accounts={accounts} onClose={() => setForm(null)} /> : null}
      {ask.element}
    </Card>
  );
}

/** Client-side dry run of the server parser on pasted text (nothing is sent or stored). */
function SampleTester({
  formats,
  generic,
  single,
}: {
  formats: readonly NotifyFormat[];
  generic: boolean;
  single?: boolean;
}) {
  const { t } = useI18n();
  const [app, setApp] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const result = useMemo(() => {
    if (!title.trim() && !text.trim()) return null;
    return parseNotification(
      formats,
      { app, package: app.toLowerCase(), title: title.trim(), text: text.trim() },
      { generic: !single && generic },
    );
  }, [formats, generic, single, app, title, text]);

  return (
    <div className="mt-4 min-w-0 space-y-2 rounded-lg border p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="size-4" aria-hidden /> {t("Uji teks contoh")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("Tempel notifikasi asli (samarkan nama/nomor). Diproses di browser, tidak dikirim.")}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          aria-label={t("Aplikasi atau nama paket")}
          placeholder={t("Aplikasi atau nama paket (mis. com.bca)")}
          maxLength={NOTIFY_LIMITS.app}
          value={app}
          onChange={(e) => setApp(e.target.value)}
        />
        <Input
          aria-label={t("Judul notifikasi")}
          placeholder={t("Judul notifikasi")}
          maxLength={NOTIFY_LIMITS.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <Textarea
        aria-label={t("Teks notifikasi")}
        placeholder={t("Teks notifikasi, mis. Dana masuk Rp 150.123,00 dari BUDI")}
        rows={3}
        maxLength={NOTIFY_LIMITS.text}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result ? (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${result.kind === "amount" ? "bg-income/10 text-income" : "bg-muted text-muted-foreground"}`}
        >
          {result.kind === "amount" ? (
            <>
              {t("Cocok")}: <strong>{t(result.format.name)}</strong> ·{" "}
              <span className="num font-semibold">
                {money(result.amount, "IDR", { reveal: true })}
              </span>
            </>
          ) : (
            <>
              {result.kind === "ignored" && result.format ? `${t(result.format.name)}: ` : ""}
              {t(result.reason)}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

function FormatDialog({
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
  const save = useServerFn(saveNotifyFormatFn);
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const values = fromForm(f);
  const problems = formatProblems(values);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length) {
      toast.error(t("Gagal menyimpan"), { description: problems.map((x) => t(x)).join(" · ") });
      return;
    }
    setBusy(true);
    try {
      await save({ data: { id: f.id, values } });
      await invalidateFor(qc, "payment_notify_formats");
      toast.success(t("Tersimpan"));
      onClose();
    } catch (err) {
      toast.error(t("Gagal menyimpan"), { description: t(errMsg(err)) });
    } finally {
      setBusy(false);
    }
  }

  const field = (
    k: "app_match" | "title_match" | "text_match" | "must_contain" | "ignore_contains",
    label: string,
    help: string,
    max: number,
  ) => (
    <div className="col-span-2 space-y-1.5">
      <Label htmlFor={`nf-${k}`}>{t(label)}</Label>
      <Input
        id={`nf-${k}`}
        maxLength={max}
        spellCheck={false}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t(help)}</p>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? t("Ubah format") : t("Tambah format")}</DialogTitle>
          <DialogDescription>
            {t("Format pertama yang cocok dengan aplikasi, judul dan teks dipakai.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="nf-name">{t("Nama format")}</Label>
            <Input
              id="nf-name"
              maxLength={NOTIFY_LIMITS.name}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          {field(
            "app_match",
            "Aplikasi",
            "Potongan nama paket atau nama aplikasi, pisahkan dengan koma (mis. com.bca, BCA). Kosong = semua aplikasi.",
            NOTIFY_LIMITS.match,
          )}
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="nf-mode">{t("Pencocokan judul/teks")}</Label>
            <Select value={f.match_mode} onValueChange={(v) => set("match_mode", v as MatchMode)}>
              <SelectTrigger id="nf-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">{t("Mengandung teks")}</SelectItem>
                <SelectItem value="regex">{t("Regex")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="nf-account">{t("Dompet invoice")}</Label>
            <Select
              value={f.account_id || NONE}
              onValueChange={(v) => set("account_id", v === NONE ? "" : v)}
            >
              <SelectTrigger id="nf-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("Semua dompet")}</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {field(
            "title_match",
            "Judul notifikasi",
            "Opsional. Kosong = judul apa saja.",
            NOTIFY_LIMITS.match,
          )}
          {field(
            "text_match",
            "Teks notifikasi",
            "Opsional. Kosong = teks apa saja.",
            NOTIFY_LIMITS.match,
          )}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="nf-regex">{t("Regex nominal")}</Label>
            <Input
              id="nf-regex"
              className="num"
              maxLength={NOTIFY_LIMITS.regex}
              spellCheck={false}
              value={f.amount_regex}
              onChange={(e) => set("amount_regex", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Grup bernama (?<amount>…) atau grup pertama berisi nominal. Format Rp 1.250.000,00 / IDR1,250,000.00 / 1.250.000 dikenali.",
              )}
            </p>
          </div>
          {field(
            "must_contain",
            "Wajib mengandung salah satu",
            "Kata kunci uang masuk, pisahkan dengan koma (mis. masuk, diterima).",
            NOTIFY_LIMITS.keywords,
          )}
          {field(
            "ignore_contains",
            "Abaikan bila mengandung",
            "Mis. keluar, debit, OTP. Notifikasi ini tidak pernah dicocokkan.",
            NOTIFY_LIMITS.keywords,
          )}
          <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="nf-enabled">{t("Aktif")}</Label>
            <Switch
              id="nf-enabled"
              checked={f.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />
          </div>
          {problems.length ? (
            <p className="col-span-2 text-xs text-expense">
              {problems.map((x) => t(x)).join(" · ")}
            </p>
          ) : null}
          <div className="col-span-2 min-w-0">
            <SampleTester formats={[{ ...values, enabled: true }]} generic={false} single />
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
