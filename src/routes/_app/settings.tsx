import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronRight, Download, History, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { RouteError } from "@/components/route-error";
import { CsvImport } from "@/components/csv-import";
import { BackupRestore } from "@/components/backup-restore";
import { TwoFactorCard } from "@/components/two-factor-card";
import { AppSettingsCard } from "@/components/app-settings-card";
import { IntegrationsCard } from "@/components/integrations-card";
import { AboutCard } from "@/components/about-card";
import { DemoDisabled } from "@/components/demo";
import { RowActions, useCrudDialog } from "@/components/crud-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fxQuery, activityQuery, rowsQuery } from "@/lib/queries";
import { exportBackupJson } from "@/lib/finance.functions";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import { activityDetail, activityLabel } from "@/lib/activity";
import type { Category } from "@/lib/schemas";

export const Route = createFileRoute("/_app/settings")({
  head: () => pageHead("Pengaturan", "Kategori, kurs, cadangan data, dan integrasi bot n8n."),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(rowsQuery("categories")),
      context.queryClient.ensureQueryData(fxQuery()),
    ]),
  errorComponent: RouteError,
  component: SettingsPage,
});

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/public/n8n/message",
    desc: "Teks bebas dari bot → dicatat otomatis",
    body: `{ "text": "makan siang 25rb", "source": "telegram", "account": "GoPay" }`,
  },
  {
    method: "POST",
    path: "/api/public/n8n/command",
    desc: "Perintah bebas bot: saldo, laporan, bayar, pengingat",
    body: `{ "text": "saldo" } · { "text": "laporan 2026-10" } · { "text": "sudah bayar Netflix" }`,
  },
  {
    method: "POST",
    path: "/api/public/n8n/ocr",
    desc: "Foto nota (base64) → dibaca AI & dicatat",
    body: `{ "image_base64": "...", "mime_type": "image/jpeg", "source": "telegram" }`,
  },
  {
    method: "POST",
    path: "/api/public/n8n/transactions",
    desc: "Data transaksi terstruktur (satu atau array)",
    body: `{ "kind": "expense", "amount": 25000, "category": "Makanan & Minuman", "account": "GoPay", "description": "Kopi" }`,
  },
  {
    method: "GET",
    path: "/api/public/n8n/reminders?days=7",
    desc: "Daftar tagihan + teks siap kirim (jadwalkan harian di n8n)",
    body: "",
  },
  {
    method: "GET",
    path: "/api/public/n8n/reminders-email?days=7",
    desc: "Pengingat siap-email (subject, text, html) untuk node Email n8n",
    body: "",
  },
  {
    method: "POST",
    path: "/api/public/n8n/reminders-send-email",
    desc: "Kirim email pengingat langsung (butuh RESEND_API_KEY, EMAIL_FROM, EMAIL_TO)",
    body: `{ "days": 7 }`,
  },
  {
    method: "GET",
    path: "/api/public/n8n/summary?month=2026-10",
    desc: "Ringkasan bulanan + teks laporan",
    body: "",
  },
];

type ActivityRow = { id: string; action: unknown; detail: unknown; created_at: string };

function SettingsPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const categories = useSuspenseQuery(rowsQuery("categories")).data as Category[];
  const { usdIdr } = useSuspenseQuery(fxQuery()).data;
  const activity = (useQuery(activityQuery(30)).data ?? []) as ActivityRow[];
  const crud = useCrudDialog("categories", { kind: "expense", color: "#d0703c" });
  const backup = useServerFn(exportBackupJson);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  async function downloadBackup() {
    setBusy(true);
    try {
      const data = await backup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `dompetku-cadangan-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("Cadangan diunduh"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("Pengaturan")} />
      <Link
        to="/profile"
        className="mb-4 flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:bg-muted/50"
      >
        <UserRound className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t("Profil & password")}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {t("Nama, alamat, foto profil, dan password.")}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => (
          <Card key={kind} className="min-w-0 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 text-lg font-semibold">
                {kind === "expense" ? t("Kategori pengeluaran") : t("Kategori pemasukan")}
              </h2>
              <Button size="sm" variant="outline" onClick={() => crud.openNew({ kind })}>
                <Plus className="size-4" /> {t("Tambah")}
              </Button>
            </div>
            <ul className="divide-y">
              {categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <li
                    key={c.id}
                    className="flex min-w-0 items-center justify-between gap-2 py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ background: c.color ?? "var(--muted-foreground)" }}
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <RowActions
                      onEdit={() => crud.openEdit({ ...c })}
                      onDelete={() => crud.remove(c.id, `kategori ${c.name}`)}
                    />
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>

      <DemoDisabled>
        <CsvImport />
      </DemoDisabled>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="min-w-0 p-5">
          <h2 className="text-lg font-semibold">{t("Kurs")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Diperbarui otomatis sekali sehari. Saat ini ")}
            <span className="num font-semibold text-foreground">
              1 USD = {money(usdIdr, "IDR", { reveal: true })}
            </span>
            .
          </p>
        </Card>
        <Card className="min-w-0 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t("Cadangan data")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "Unduh seluruh data (akun, kategori, transaksi, hutang, langganan, budget, target, kurs) sebagai satu berkas JSON.",
                )}
              </p>
            </div>
            <Button
              className="justify-self-start sm:justify-self-end"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={downloadBackup}
            >
              <Download className="size-4" /> {t("Unduh cadangan (JSON)")}
            </Button>
          </div>
        </Card>
      </div>

      <DemoDisabled>
        <BackupRestore />
      </DemoDisabled>

      <Card className="mt-4 min-w-0 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <History className="size-4" /> {t("Catatan aktivitas")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("Riwayat perubahan data terbaru.")}</p>
        {activity.length ? (
          <ul className="mt-3 max-h-72 space-y-1 overflow-auto text-sm">
            {activity.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 odd:bg-muted/50"
              >
                <span className="min-w-0 truncate">
                  <span
                    className={
                      String(a.action) === "auth.login_failed"
                        ? "font-medium text-expense"
                        : "font-medium"
                    }
                  >
                    {activityLabel(String(a.action), t)}
                  </span>
                  {activityDetail(a.detail, (n, c) => money(n, c)) ? (
                    <span className="ml-2 text-muted-foreground">
                      {activityDetail(a.detail, (n, c) => money(n, c))}
                    </span>
                  ) : null}
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString(lang === "en" ? "en-US" : "id-ID", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("Belum ada aktivitas.")}</p>
        )}
      </Card>

      <DemoDisabled>
        <AppSettingsCard />
      </DemoDisabled>

      <DemoDisabled>
        <IntegrationsCard />
      </DemoDisabled>

      <DemoDisabled>
        <TwoFactorCard />
      </DemoDisabled>

      <Card className="mt-4 min-w-0 p-5">
        <h2 className="text-lg font-semibold">
          {t("Integrasi n8n (Telegram / WhatsApp / Email)")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Kirim header ")}
          <code className="rounded bg-muted px-1">x-api-key: &lt;N8N_API_KEY&gt;</code>
          {t(" di setiap request. Semua respons berisi field ")}
          <code className="rounded bg-muted px-1">message</code>
          {t(" yang bisa langsung dibalas ke chat.")}
        </p>
        <ul className="mt-4 space-y-3">
          {ENDPOINTS.map((e) => (
            <li key={e.path} className="rounded-xl border p-3">
              <p className="min-w-0 text-sm">
                <span className="mr-2 rounded bg-ink px-1.5 py-0.5 text-xs font-semibold text-ink-foreground">
                  {e.method}
                </span>
                <code className="num break-all text-xs">
                  {origin}
                  {e.path}
                </code>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t(e.desc)}</p>
              {e.body ? (
                <pre className="num mt-2 overflow-x-auto rounded-lg bg-muted p-2 text-xs">
                  {e.body}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {crud.dialog(t("kategori"), [
        { name: "name", label: t("Nama"), type: "text" },
        {
          name: "kind",
          label: t("Jenis"),
          type: "select",
          half: true,
          options: [
            { value: "expense", label: t("Pengeluaran") },
            { value: "income", label: t("Pemasukan") },
          ],
        },
        { name: "color", label: t("Warna"), type: "color", half: true },
      ])}
      <AboutCard />
    </>
  );
}
