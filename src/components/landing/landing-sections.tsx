import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  ChartColumn,
  CircleCheck,
  Cloud,
  Coins,
  Database,
  DatabaseBackup,
  GitFork,
  Github,
  Heart,
  Languages,
  Lock,
  Moon,
  PiggyBank,
  Repeat,
  Rocket,
  ScanLine,
  Send,
  ShieldCheck,
  Smartphone,
  Split,
  Workflow,
} from "lucide-react";
import { AppLogo, AppName } from "@/components/app-logo";
import { VersionBadge } from "@/components/version-badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { docsUrl, LANDING_FAQ } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { AuthButton, DemoLink, LANDING_NAV, SectionLink } from "./landing-header";
import { useIsDemo } from "@/components/demo";
import { TECH_ICONS, TechLogo, type TechIconName } from "./tech-icons";
import { BrowserFrame, PhoneFrame, Screenshot } from "./screenshot";

const container = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">{t(eyebrow)}</p>
      <h2
        id={id}
        className="mt-3 font-display text-3xl font-bold text-balance text-foreground sm:text-4xl"
      >
        {t(title)}
      </h2>
      {lead ? (
        <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{t(lead)}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Hero */

export function Hero({
  tagline,
  repo,
  authenticated,
}: {
  tagline: string | null;
  repo: string;
  authenticated: boolean;
}) {
  const { t } = useI18n();
  const demo = useIsDemo();
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="landing-glow absolute inset-0 -z-10" />
      <div
        className={cn(
          container,
          "grid items-center gap-12 pt-10 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10 lg:pt-20 lg:pb-24 short:pt-6",
        )}
      >
        <div className="landing-rise text-center lg:text-left">
          <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-income" aria-hidden="true" />
            {t("Open source · MIT · Self-hosted")}
          </p>
          <h1
            id="hero-title"
            className="mt-5 font-display text-4xl leading-[1.05] font-extrabold text-balance text-foreground sm:text-5xl xl:text-6xl"
          >
            {t("Catat setiap rupiah.")}{" "}
            <span className="text-primary">{t("Kendalikan semuanya.")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg lg:mx-0">
            {tagline ??
              t(
                "Pelacak keuangan pribadi yang Anda host sendiri — transaksi, budget, hutang, emas, dan bot Telegram dalam satu aplikasi privat.",
              )}
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-start">
            {demo ? (
              <AuthButton
                authenticated={authenticated}
                size="lg"
                className="order-first h-11 rounded-full px-6 text-base"
              />
            ) : null}
            <Button
              asChild
              size="lg"
              variant={demo ? "outline" : "default"}
              className="h-11 rounded-full px-6 text-base"
            >
              <a href={docsUrl(repo, "docs/SELF-HOSTING.md")} target="_blank" rel="noreferrer">
                <Rocket />
                {t("Self-host gratis")}
              </a>
            </Button>
            <DemoLink
              size="lg"
              className="h-11 rounded-full border-primary/40 bg-card px-6 text-base shadow-sm"
            />
            {demo ? null : (
              <AuthButton
                authenticated={authenticated}
                size="lg"
                className="h-11 rounded-full border border-input bg-card px-6 text-base text-foreground shadow-sm hover:bg-muted"
              />
            )}
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground lg:justify-start">
            {[
              "Data di database Anda sendiri",
              "Gratis di tier free",
              "Bahasa Indonesia & English",
            ].map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <CircleCheck className="size-4 text-income" aria-hidden="true" />
                {t(s)}
              </li>
            ))}
          </ul>
        </div>
        <div className="landing-rise landing-delay relative mx-auto w-full max-w-2xl lg:max-w-none">
          <BrowserFrame>
            <Screenshot
              name="dashboard"
              alt={t("Tampilan dashboard: saldo, arus kas, dan kekayaan bersih")}
              priority
            />
          </BrowserFrame>
          <PhoneFrame className="absolute -bottom-8 -left-6 hidden w-[24%] sm:block lg:-left-10">
            <Screenshot
              name="dashboard-mobile"
              variant="mobile"
              alt={t("Tampilan dashboard di ponsel")}
              priority
            />
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Bento */

function Tile({
  className,
  icon,
  title,
  body,
  children,
  tone = "card",
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
  tone?: "card" | "ink" | "accent";
}) {
  const { t } = useI18n();
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border p-6 sm:p-7",
        tone === "card" && "bg-card text-card-foreground",
        tone === "ink" && "border-transparent bg-sidebar text-sidebar-foreground",
        tone === "accent" && "border-transparent bg-secondary text-secondary-foreground",
        "h-full",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-xl [&_svg]:size-5",
          tone === "ink"
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "bg-primary/10 text-primary",
        )}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="mt-4 font-display text-xl font-bold text-balance">{t(title)}</h3>
      <p
        className={cn(
          "mt-2 text-sm leading-relaxed text-pretty",
          tone === "ink" ? "text-sidebar-foreground/75" : "text-muted-foreground",
        )}
      >
        {t(body)}
      </p>
      {children}
    </article>
  );
}

function BudgetBars() {
  const { t } = useI18n();
  const rows = [
    { label: "Makan", pct: 64, tone: "bg-income" },
    { label: "Transportasi", pct: 86, tone: "bg-warning" },
    { label: "Hiburan", pct: 104, tone: "bg-expense" },
  ];
  return (
    <ul className="mt-5 space-y-3" aria-hidden="true">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs font-medium">
            <span>{t(r.label)}</span>
            <span className="num text-muted-foreground">{r.pct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("landing-bar h-full rounded-full", r.tone)}
              style={{ width: `${Math.min(r.pct, 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProjectionLine() {
  return (
    <svg viewBox="0 0 200 64" className="mt-5 h-16 w-full" aria-hidden="true">
      <defs>
        <linearGradient id="lp-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-chart-2)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-chart-2)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 56 L40 50 L80 42 L120 30 L160 20 L200 8 L200 64 L0 64 Z" fill="url(#lp-fill)" />
      <path
        d="M0 56 L40 50 L80 42 L120 30"
        fill="none"
        stroke="var(--color-chart-2)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M120 30 L160 20 L200 8"
        fill="none"
        stroke="var(--color-chart-2)"
        strokeWidth="2.5"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
      <circle cx="200" cy="8" r="4" fill="var(--color-chart-2)" />
    </svg>
  );
}

function Chips({ items, className }: { items: string[]; className?: string }) {
  const { t } = useI18n();
  return (
    <ul className={cn("mt-5 flex flex-wrap gap-2", className)}>
      {items.map((s) => (
        <li
          key={s}
          className="rounded-full border bg-background/60 px-3 py-1 text-xs font-medium text-foreground"
        >
          {t(s)}
        </li>
      ))}
    </ul>
  );
}

export function FeatureBento() {
  const { t } = useI18n();
  // Peek: the screenshot hangs off the bottom/right edge of a large tile.
  const peek = "mt-6 -mr-10 -mb-10 sm:-mr-12 sm:-mb-12";
  return (
    <section id="fitur" aria-labelledby="fitur-title" className={cn(container, "py-16 sm:py-24")}>
      <SectionHeading
        id="fitur-title"
        eyebrow="Fitur"
        title="Semua yang Anda perlukan untuk mengatur uang"
        lead="Dari catatan harian sampai laporan tahunan — dirancang untuk rupiah, cicilan, dan kebiasaan keuangan di Indonesia."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-6 lg:gap-5">
        <div className="md:col-span-4 lg:col-span-4 lg:row-span-2">
          <Tile
            icon={<ChartColumn />}
            title="Dashboard & kekayaan bersih"
            body="Saldo semua akun, arus kas 6 bulan, pengeluaran per kategori, dan tren kekayaan bersih — termasuk emas dan piutang."
          >
            <div className={peek}>
              <BrowserFrame>
                <Screenshot name="dashboard" alt={t("Dashboard dengan grafik arus kas")} />
              </BrowserFrame>
            </div>
          </Tile>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <Tile
            icon={<PiggyBank />}
            title="Budget dengan rollover"
            body="Sisa budget bisa dibawa ke bulan berikutnya, dengan peringatan saat mencapai 80% dan 100%."
          >
            <BudgetBars />
          </Tile>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <Tile
            tone="ink"
            icon={<ShieldCheck />}
            title="Privat sejak awal"
            body="Mode privasi menyembunyikan angka, login bisa dengan 2FA, dan data tersimpan di database Supabase milik Anda sendiri."
          >
            <p
              className="num mt-5 rounded-xl bg-sidebar-accent px-4 py-3 text-lg font-semibold tracking-widest text-sidebar-primary"
              aria-hidden="true"
            >
              Rp ••••••••
            </p>
          </Tile>
        </div>
        <div className="md:col-span-2 lg:col-span-2 lg:row-span-2">
          <Tile
            icon={<Send />}
            title="Bot Telegram + OCR struk"
            body="Ketik “kopi 25rb” atau kirim foto struk; bot menampilkan pratinjau, Anda tinggal tekan ✅."
          >
            <PhoneFrame className="mx-auto mt-6 w-full max-w-56">
              <Screenshot
                name="telegram-bot"
                variant="mobile"
                alt={t("Percakapan dengan bot Telegram")}
              />
            </PhoneFrame>
          </Tile>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <Tile
            icon={<Repeat />}
            title="Transaksi berulang & split"
            body="Gaji, cicilan, dan langganan tercatat otomatis. Satu struk bisa dipecah ke beberapa kategori."
          >
            <div className="mt-5 flex items-center gap-2 text-xs font-medium" aria-hidden="true">
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-primary">
                <Repeat className="size-3.5" /> {t("Bulanan")}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-accent/40 px-3 py-1 text-accent-foreground dark:text-foreground">
                <Split className="size-3.5" /> {t("3 kategori")}
              </span>
            </div>
          </Tile>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <Tile
            icon={<Coins />}
            title="Emas, piutang & target"
            body="Harga emas Antam harian, piutang yang terhubung ke akun, dan proyeksi kapan target tabungan tercapai."
          >
            <ProjectionLine />
          </Tile>
        </div>
        <div className="md:col-span-4 lg:col-span-4">
          <Tile
            icon={<ScanLine />}
            title="Laporan & rekonsiliasi akun"
            body="Rekap tahunan, tren per kategori, laporan per akun, dan cocokkan saldo dengan mutasi bank dalam beberapa klik."
          >
            <div className={cn(peek, "max-h-72 overflow-hidden rounded-tl-xl sm:max-h-80")}>
              <BrowserFrame>
                <Screenshot name="reports" alt={t("Halaman laporan dan rekap tahunan")} />
              </BrowserFrame>
            </div>
          </Tile>
        </div>
        <div className="md:col-span-4 lg:col-span-6">
          <Tile
            tone="accent"
            icon={<DatabaseBackup />}
            title="Detail kecil yang membuatnya nyaman"
            body="Semua hal yang Anda harapkan dari aplikasi modern, tanpa langganan."
          >
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: DatabaseBackup, label: "Backup & restore JSON" },
                { icon: Smartphone, label: "Bisa di-install (PWA)" },
                { icon: Languages, label: "Bahasa Indonesia & English" },
                { icon: Moon, label: "Mode gelap" },
              ].map(({ icon: I, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-3 rounded-2xl bg-background/70 px-4 py-3 text-sm font-medium text-foreground"
                >
                  <I className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {t(label)}
                </li>
              ))}
            </ul>
          </Tile>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- How it works */

export function HowItWorks() {
  const { t } = useI18n();
  const nodes = [
    {
      icon: Send,
      name: "Telegram",
      body: "Anda mengetik atau mengirim foto struk ke bot.",
    },
    {
      icon: Workflow,
      name: "n8n",
      body: "n8n meneruskan pesan ke aplikasi dengan API key.",
    },
    {
      icon: Bot,
      name: "Dompetku",
      body: "Aplikasi membaca, menebak kategori, lalu menyimpan setelah Anda konfirmasi.",
    },
  ];
  return (
    <section
      id="cara-kerja"
      aria-labelledby="cara-kerja-title"
      className="border-y bg-muted/40 py-16 sm:py-24"
    >
      <div className={container}>
        <SectionHeading
          id="cara-kerja-title"
          eyebrow="Cara kerja"
          title="Catat dari chat, rapi di aplikasi"
          lead="Bot Telegram opsional. Tanpa bot pun, aplikasi web sudah lengkap."
        />
        <ol className="mt-12 grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {nodes.map((n, i) => (
            <li key={n.name} className="contents">
              {i > 0 ? (
                <div
                  aria-hidden="true"
                  className="flex items-center justify-center text-muted-foreground"
                >
                  <ArrowRight className="size-5 rotate-90 md:rotate-0" />
                </div>
              ) : null}
              <div className="rounded-3xl border bg-card p-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <n.icon className="size-6" aria-hidden="true" />
                </div>
                <p className="mt-4 font-display text-lg font-bold">{n.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t(n.body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Self-host */

export function SelfHost({ repo }: { repo: string }) {
  const { t } = useI18n();
  const steps = [
    { icon: GitFork, title: "Fork repo", body: "Salin kode ke akun GitHub Anda." },
    { icon: Database, title: "Buat Supabase", body: "Jalankan schema.sql di database gratis." },
    { icon: Cloud, title: "Deploy ke Vercel", body: "Isi beberapa environment variable." },
    { icon: CircleCheck, title: "Selesai", body: "Masuk dan mulai mencatat." },
  ];
  return (
    <section
      id="self-host"
      aria-labelledby="self-host-title"
      className={cn(container, "py-16 sm:py-24")}
    >
      <SectionHeading
        id="self-host-title"
        eyebrow="Self-host"
        title="Punya Anda sendiri dalam 4 langkah"
        lead="Sekitar 20–30 menit, tanpa biaya. Panduan langkah demi langkah tersedia untuk pemula."
      />
      <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-3xl border bg-card p-6">
            <span
              className="num absolute top-5 right-6 text-4xl font-bold text-foreground/10"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <s.icon className="size-6 text-primary" aria-hidden="true" />
            <h3 className="mt-4 font-display text-lg font-bold">
              <span className="sr-only">{i + 1}. </span>
              {t(s.title)}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(s.body)}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-11 rounded-full px-6">
          <a href={docsUrl(repo, "docs/SELF-HOSTING.md")} target="_blank" rel="noreferrer">
            <BookOpen />
            {t("Baca panduan self-host")}
          </a>
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="h-11 rounded-full bg-card px-6 hover:bg-muted hover:text-foreground"
        >
          <a href={repo} target="_blank" rel="noreferrer">
            <Github />
            {t("Lihat di GitHub")}
          </a>
        </Button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Tech stack */

const STACK: TechIconName[] = [
  "react",
  "tanstack",
  "typescript",
  "vite",
  "tailwindcss",
  "shadcnui",
  "radixui",
  "supabase",
  "postgresql",
  "vercel",
  "n8n",
  "telegram",
  "zod",
  "vitest",
  "githubactions",
];

function StackItems({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      className="landing-marquee-group"
      aria-hidden={duplicate || undefined}
      role={duplicate ? "presentation" : undefined}
    >
      {STACK.map((name) => {
        const icon = TECH_ICONS[name];
        return (
          <li
            key={name}
            className="landing-tech flex shrink-0 items-center gap-2.5 rounded-full border bg-card/70 px-4 py-2 text-sm font-semibold text-foreground/75 transition-colors hover:text-foreground"
            style={icon.hex ? ({ "--tech-hex": icon.hex } as CSSProperties) : undefined}
          >
            <TechLogo name={name} className="size-5 shrink-0" />
            <span className="whitespace-nowrap">{icon.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Logo marquee: the set is rendered twice and slid by -50% for a seamless loop (CSS only). */
export function TechStack() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="stack-title" className="border-y bg-muted/40 py-10">
      <div className="flex flex-col items-center gap-6">
        <h2
          id="stack-title"
          className="font-sans text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase"
        >
          {t("Dibangun dengan")}
        </h2>
        <div className="landing-marquee w-full" data-testid="tech-marquee">
          <div className="landing-marquee-track">
            <StackItems />
            <StackItems duplicate />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- FAQ */

export function Faq() {
  const { t } = useI18n();
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(container, "py-16 sm:py-24")}>
      <SectionHeading id="faq-title" eyebrow="FAQ" title="Pertanyaan yang sering diajukan" />
      <Accordion type="single" collapsible className="mx-auto mt-10 max-w-3xl">
        {LANDING_FAQ.map((f, i) => (
          <AccordionItem key={f.q} value={`q${i}`}>
            <AccordionTrigger className="py-5 text-left font-display text-base font-semibold hover:no-underline focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:text-lg">
              {t(f.q)}
            </AccordionTrigger>
            <AccordionContent className="text-base leading-relaxed text-muted-foreground">
              {t(f.a)}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/* ---------------------------------------------------------------- CTA + footer */

export function FinalCta({ repo, authenticated }: { repo: string; authenticated: boolean }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="cta-title" className={cn(container, "pb-16 sm:pb-24")}>
      <div className="landing-cta relative overflow-hidden rounded-[2rem] bg-sidebar px-6 py-12 text-center text-sidebar-foreground sm:px-12 sm:py-16">
        <h2 id="cta-title" className="font-display text-3xl font-bold text-balance sm:text-4xl">
          {t("Mulai rapikan keuangan Anda hari ini")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sidebar-foreground/75">
          {t("Gratis, privat, dan sepenuhnya milik Anda.")}
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            asChild
            size="lg"
            className="h-11 rounded-full bg-sidebar-primary px-6 text-sidebar-primary-foreground hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <a href={docsUrl(repo, "docs/SELF-HOSTING.md")} target="_blank" rel="noreferrer">
              <Rocket />
              {t("Self-host gratis")}
            </a>
          </Button>
          <DemoLink
            size="lg"
            variant="secondary"
            className="h-11 rounded-full bg-sidebar-accent px-6 text-sidebar-accent-foreground hover:bg-sidebar-accent/80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          />
          <AuthButton
            authenticated={authenticated}
            size="lg"
            className="h-11 rounded-full bg-sidebar-accent px-6 text-sidebar-accent-foreground hover:bg-sidebar-accent/80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          />
        </div>
      </div>
    </section>
  );
}

const LEGAL_LINKS = [
  { to: "/privacy", label: "Privasi" },
  { to: "/terms", label: "Ketentuan" },
] as const;

export function LandingFooter({ repo, onLanding = true }: { repo: string; onLanding?: boolean }) {
  const { t } = useI18n();
  const link =
    "rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const docs = [
    { file: "docs/SELF-HOSTING.md", label: "Panduan self-host" },
    { file: "docs/N8N.md", label: "Bot Telegram & n8n" },
    { file: "docs/ENVIRONMENT.md", label: "Environment variable" },
    { file: "docs/FAQ.md", label: "FAQ lengkap" },
  ];
  return (
    <footer className="border-t bg-card/60">
      <div className={cn(container, "grid gap-10 py-12 sm:grid-cols-3 lg:grid-cols-5")}>
        <div className="sm:col-span-3 lg:col-span-2">
          <p className="flex items-center gap-2.5 font-display text-xl font-bold">
            <AppLogo className="size-8" />
            <AppName className="[&>span]:text-accent-foreground dark:[&>span]:text-accent" />
          </p>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {t("Pelacak keuangan pribadi open source yang Anda host sendiri.")}
          </p>
        </div>
        <nav aria-label={t("Halaman")}>
          <h2 className="font-sans text-sm font-semibold">{t("Halaman")}</h2>
          <ul className="mt-3 space-y-2">
            {LANDING_NAV.map((n) => (
              <li key={n.hash}>
                <SectionLink hash={n.hash} onLanding={onLanding} className={link}>
                  {t(n.label)}
                </SectionLink>
              </li>
            ))}
            <li>
              <a href={repo} target="_blank" rel="noreferrer" className={link}>
                GitHub
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label={t("Dokumentasi")}>
          <h2 className="font-sans text-sm font-semibold">{t("Dokumentasi")}</h2>
          <ul className="mt-3 space-y-2">
            {docs.map((d) => (
              <li key={d.file}>
                <a href={docsUrl(repo, d.file)} target="_blank" rel="noreferrer" className={link}>
                  {t(d.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("Legal")}>
          <h2 className="font-sans text-sm font-semibold">{t("Legal")}</h2>
          <ul className="mt-3 space-y-2">
            {LEGAL_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={link}>
                  {t(l.label)}
                </Link>
              </li>
            ))}
            <li>
              <a href={docsUrl(repo, "LICENSE")} target="_blank" rel="noreferrer" className={link}>
                {t("Lisensi MIT")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <div
          className={cn(
            container,
            // Extra end/bottom padding keeps the text clear of the floating back-to-top button.
            "flex flex-col items-center justify-between gap-3 pt-6 pb-20 text-sm text-muted-foreground sm:flex-row sm:pb-6 sm:pr-20 lg:pr-20",
          )}
        >
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <li>
              <a href={docsUrl(repo, "LICENSE")} target="_blank" rel="noreferrer" className={link}>
                {t("Lisensi MIT")}
              </a>
            </li>
            {LEGAL_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={link}>
                  {t(l.label)}
                </Link>
              </li>
            ))}
            <li>
              <VersionBadge variant="footer" />
            </li>
          </ul>
          <p className="flex items-center gap-1.5">
            {t("Dibuat dengan")}
            <Heart className="size-4 fill-expense text-expense" aria-label={t("cinta")} />
            {t("di Indonesia")}
          </p>
        </div>
      </div>
    </footer>
  );
}
