import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  CalendarClock,
  Coins,
  CreditCard,
  Eye,
  EyeOff,
  HandCoins,
  LayoutDashboard,
  Languages,
  LogOut,
  Moon,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  Sun,
  Target,
  Wallet,
} from "lucide-react";
import { logout } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { AppLogo, AppName, useTagline } from "@/components/app-logo";
import { togglePrivate, usePrivacy } from "@/lib/privacy";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BackToTop } from "@/components/back-to-top";
import { ProfileLink } from "@/components/user-avatar";
import { DemoBanner } from "@/components/demo";
import { VersionBadge, VersionRailLabel, useVersionText } from "@/components/version-badge";
import { cn } from "@/lib/utils";
import { useAccess } from "@/hooks/use-access";
import { canOpenPath } from "@/lib/permissions";

const ALL_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transaksi", icon: Receipt },
  { to: "/reports", label: "Laporan", icon: BarChart3 },
  { to: "/rekap", label: "Rekap Tahunan", icon: BarChart3 },
  { to: "/accounts", label: "Akun", icon: Wallet },
  { to: "/debts", label: "Hutang & Cicilan", icon: CreditCard },
  { to: "/subscriptions", label: "Langganan", icon: Repeat },
  { to: "/recurring", label: "Transaksi Berulang", icon: CalendarClock },
  { to: "/budgets", label: "Budget", icon: PiggyBank },
  { to: "/goals", label: "Target", icon: Target },
  { to: "/gold", label: "Emas", icon: Coins },
  { to: "/receivables", label: "Piutang", icon: HandCoins },
  { to: "/reminders", label: "Pengingat", icon: Bell },
  { to: "/settings", label: "Pengaturan", icon: Settings },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const d = !dark;
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("dk-theme", d ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(d);
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={toggle}
      aria-label={dark ? t("Mode terang") : t("Mode gelap")}
      className={
        className ??
        "flex w-full justify-start gap-3 px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-accent"
      }
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {className === undefined ? (dark ? t("Mode terang") : t("Mode gelap")) : null}
    </Button>
  );
}

export function PrivacyToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const hidden = usePrivacy();
  const label = hidden ? t("Tampilkan angka") : t("Sembunyikan angka");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          onClick={togglePrivate}
          aria-label={label}
          aria-pressed={hidden}
          aria-keyshortcuts="Shift+H"
          className={
            className ??
            "flex w-full justify-start gap-3 px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-accent"
          }
        >
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {className === undefined ? label : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={className === undefined ? "right" : "bottom"}>
        {label} (Shift+H)
      </TooltipContent>
    </Tooltip>
  );
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setLang(lang === "id" ? "en" : "id")}
      aria-label={t("Ganti bahasa")}
      className={
        className ??
        "flex w-full justify-start gap-3 px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-accent"
      }
    >
      <Languages className="size-4" />
      {className === undefined ? (
        lang === "id" ? (
          "EN"
        ) : (
          "ID"
        )
      ) : (
        <span className="text-xs font-semibold">{lang.toUpperCase()}</span>
      )}
    </Button>
  );
}

/** Matches the `short` custom variant (landscape phones), where the mobile header is static. */
const SHORT_QUERY = "(max-height: 500px) and (orientation: landscape)";

/**
 * Mobile header state: `scrolled` past a few px (border/shadow) and `compact` (brand row
 * collapsed so only the nav pills stay pinned). Collapsing changes the page height by about
 * the row (~60 px), and browser scroll anchoring may shift scrollY by that much, so the
 * thresholds are far apart (collapse past 96 px, expand only back at the very top, where
 * anchoring never applies) and pages without enough room never collapse, avoiding flicker.
 */
function useCompactHeader(): { scrolled: boolean; compact: boolean } {
  const [state, setState] = useState({ scrolled: false, compact: false });
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const y = window.scrollY;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const short =
        typeof window.matchMedia === "function" && window.matchMedia(SHORT_QUERY).matches;
      setState((prev) => {
        const compact = short ? false : prev.compact ? y > 0 : y > 96 && room > 200;
        const scrolled = y > 4;
        return prev.compact === compact && prev.scrolled === scrolled
          ? prev
          : { scrolled, compact };
      });
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return state;
}

/** Navigation for the role (members only see the modules they may open; UI only). */
function useNav() {
  const { role } = useAccess();
  return ALL_NAV.filter((n) => canOpenPath(role, n.to));
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const NAV = useNav();
  const doLogout = useServerFn(logout);
  const tagline = useTagline();
  const navigate = useNavigate();
  const router = useRouter();
  async function out() {
    await doLogout();
    await router.invalidate();
    await navigate({ to: "/login" });
  }
  const sideItem =
    "flex items-center justify-center gap-3 rounded-lg p-2.5 text-sm transition-colors hover:bg-sidebar-accent lg:justify-start lg:px-3 lg:py-2";
  const versionText = useVersionText();
  const sideTool =
    "flex w-full justify-center gap-3 px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-accent lg:justify-start";
  const { scrolled, compact } = useCompactHeader();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navRef = useRef<HTMLElement>(null);
  // Keep the active pill visible in the horizontal mobile nav. Only the nav's own scrollLeft
  // changes (scrollIntoView would also move the page vertically).
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "instant" });
  }, [pathname]);
  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen w-full max-w-full overflow-x-clip md:grid md:grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col overflow-y-auto bg-sidebar px-2 py-4 text-sidebar-foreground md:flex lg:w-[240px] lg:p-4">
          <div className="mb-6 px-1 pt-2 text-center lg:mb-8 lg:px-2 lg:text-left">
            <p className="flex items-center justify-center gap-2 font-display text-2xl font-bold lg:justify-start">
              <AppLogo className="size-9 lg:size-8" />
              <AppName className="hidden min-w-0 truncate lg:inline" />
            </p>
            <p className="hidden truncate text-xs text-ink-muted lg:block">{tagline}</p>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((n) => (
              <Tooltip key={n.to}>
                <TooltipTrigger asChild>
                  <Link
                    to={n.to}
                    aria-label={t(n.label)}
                    className={sideItem}
                    activeProps={{
                      className: "bg-sidebar-accent text-sidebar-primary font-semibold",
                    }}
                  >
                    <n.icon className="size-5 shrink-0 lg:size-4" />{" "}
                    <span className="hidden truncate lg:inline">{t(n.label)}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="lg:hidden">
                  {t(n.label)}
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-0.5">
            <div className="hidden lg:contents">
              <ThemeToggle />
              <LanguageToggle />
              <PrivacyToggle />
            </div>
            <div className="flex flex-col items-center gap-0.5 lg:hidden">
              <ThemeToggle className="size-11 p-0 text-ink-muted hover:bg-sidebar-accent" />
              <LanguageToggle className="h-11 w-full gap-1 px-1 text-ink-muted hover:bg-sidebar-accent" />
              <PrivacyToggle className="size-11 p-0 text-ink-muted hover:bg-sidebar-accent" />
            </div>
            <ProfileLink
              labelled
              className="justify-center rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-accent lg:justify-start"
              avatarClassName="size-7"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={out}
              aria-label={t("Keluar")}
              className={sideTool}
            >
              <LogOut className="size-4" /> <span className="hidden lg:inline">{t("Keluar")}</span>
            </Button>
            <VersionBadge variant="sidebar" className="mt-2 hidden px-3 lg:flex" />
            <Tooltip>
              <TooltipTrigger asChild>
                <VersionRailLabel className="mx-auto mt-2 lg:hidden" />
              </TooltipTrigger>
              <TooltipContent side="right" className="lg:hidden">
                {versionText}
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>
        <div className="min-w-0 md:col-start-2">
          <DemoBanner />
          <header
            className={cn(
              "no-print sticky top-0 z-30 border-b bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground transition-[box-shadow,border-color] duration-200 motion-reduce:transition-none short:static short:border-transparent short:shadow-none md:hidden",
              scrolled ? "border-sidebar-border shadow-md" : "border-transparent",
            )}
          >
            {/* Brand + tools collapse (grid rows 1fr -> 0fr) once scrolled so only the nav stays
                pinned; `inert` keeps the collapsed controls out of the tab order. */}
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none short:grid-rows-[1fr] short:opacity-100",
                compact ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
              )}
              inert={compact}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 short:py-1.5">
                  <p className="flex min-w-0 items-center gap-2 font-display text-xl font-bold">
                    <AppLogo className="size-7" />
                    <AppName className="min-w-0 truncate" />
                  </p>
                  <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                    <LanguageToggle className="h-9 shrink-0 gap-1.5 px-2" />
                    <ThemeToggle className="size-9 shrink-0 p-0" />
                    <PrivacyToggle className="size-9 shrink-0 p-0" />
                    <ProfileLink
                      className="size-9 shrink-0 justify-center rounded-md"
                      avatarClassName="size-7"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0"
                      onClick={out}
                      aria-label={t("Keluar")}
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <nav
              ref={navRef}
              className={cn(
                "no-scrollbar flex max-w-full gap-1 overflow-x-auto px-3 pb-3 transition-[padding] duration-200 motion-reduce:transition-none short:pb-2",
                compact && "pt-2",
              )}
              aria-label={t("Menu utama")}
            >
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                  activeProps={{
                    className: "bg-sidebar-primary text-sidebar-primary-foreground font-semibold",
                  }}
                >
                  <n.icon className="size-3.5" /> {t(n.label)}
                </Link>
              ))}
            </nav>
          </header>
          <main
            id="app-main"
            tabIndex={-1}
            className="mx-auto w-full min-w-0 max-w-6xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] focus:outline-none sm:p-6 lg:p-8"
          >
            {children}
          </main>
          <BackToTop focusId="app-main" className="no-print" />
        </div>
      </div>
    </TooltipProvider>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-sm:grid-cols-1">
      <div className="min-w-0">
        <h1 className="break-words text-3xl font-bold sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="no-print flex min-w-0 max-w-full flex-wrap gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
