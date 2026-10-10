import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { FlaskConical, Github, Languages, Menu, Moon, Sun } from "lucide-react";
import { AppLogo, AppName, useBranding } from "@/components/app-logo";
import { useIsDemo } from "@/components/demo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";
import { isLangPath, langHref, langSearch, otherLang } from "@/lib/lang";
import { useScrolledPast } from "@/hooks/use-scrolled-past";
import { cn } from "@/lib/utils";

export const LANDING_NAV = [
  { hash: "fitur", label: "Fitur" },
  { hash: "cara-kerja", label: "Cara kerja" },
  { hash: "self-host", label: "Self-host" },
] as const;

/**
 * In-page section link: a plain `#hash` anchor on the landing page itself (smooth CSS scroll),
 * a router link to `/#hash` from the legal pages.
 */
export function SectionLink({
  hash,
  onLanding,
  className,
  onClick,
  children,
}: {
  hash: string;
  onLanding: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  if (onLanding) {
    return (
      <a href={`#${hash}`} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to="/" search={langSearch(lang)} hash={hash} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

/** Small, dependency-free theme switch (same `dk-theme` contract as the app shell). */
function ThemeButton() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
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
      size="icon"
      onClick={toggle}
      aria-label={dark ? t("Mode terang") : t("Mode gelap")}
      className="hover:bg-muted hover:text-foreground"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

/**
 * Language switch for the public pages: persists the choice (`dk-lang`) and moves to that
 * language's own crawlable URL (`?lang=en`, no param for Indonesian), keeping the section hash.
 */
function LangButton() {
  const { lang, setLang, t } = useI18n();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  function toggle() {
    const next = otherLang(lang);
    setLang(next);
    if (!isLangPath(pathname)) return;
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    void router.navigate({ href: langHref(pathname, next, hash), resetScroll: false });
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={toggle}
      aria-label={t("Ganti bahasa")}
      className="h-9 gap-1.5 px-2.5 hover:bg-muted hover:text-foreground"
    >
      <Languages />
      <span className="text-xs font-semibold">{lang.toUpperCase()}</span>
    </Button>
  );
}

export function AuthButton({
  authenticated,
  className,
  size = "sm",
}: {
  authenticated: boolean;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const { t } = useI18n();
  // On a demo instance (DEMO_MODE=true) the sign-in button leads straight to the one-click demo.
  const demo = useIsDemo();
  return (
    <Button asChild size={size} className={className}>
      {authenticated ? (
        <Link to="/dashboard">{t("Buka Dashboard")}</Link>
      ) : (
        <Link to="/login">{demo ? t("Masuk ke demo") : t("Masuk")}</Link>
      )}
    </Button>
  );
}

/**
 * "Coba demo" link to the public demo instance (env PUBLIC_DEMO_URL via public branding).
 * Renders nothing when no demo URL is configured, or on the demo instance itself.
 */
export function DemoLink({
  className,
  size = "sm",
  variant = "outline",
}: {
  className?: string;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "ghost" | "secondary";
}) {
  const { t } = useI18n();
  const url = useBranding().demo_url;
  const demo = useIsDemo();
  if (!url || demo) return null;
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={url} target="_blank" rel="noreferrer">
        <FlaskConical />
        {t("Coba demo")}
      </a>
    </Button>
  );
}

export function LandingHeader({
  authenticated,
  repo,
  onLanding = true,
}: {
  authenticated: boolean;
  repo: string;
  onLanding?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const scrolled = useScrolledPast(() => 8);
  const link =
    "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-200",
        scrolled
          ? "border-border bg-background/85 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
          : "border-transparent bg-transparent shadow-none",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          search={langSearch(lang)}
          className="flex min-w-0 items-center gap-2.5 rounded-md font-display text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AppLogo className="size-8" />
          <AppName className="min-w-0 truncate [&>span]:text-accent-foreground dark:[&>span]:text-accent" />
        </Link>
        <nav aria-label={t("Navigasi halaman")} className="ml-6 hidden items-center lg:flex">
          {LANDING_NAV.map((n) => (
            <SectionLink key={n.hash} hash={n.hash} onLanding={onLanding} className={link}>
              {t(n.label)}
            </SectionLink>
          ))}
          <a href={repo} target="_blank" rel="noreferrer" className={link}>
            GitHub
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <div className="hidden items-center sm:flex">
            <LangButton />
            <ThemeButton />
          </div>
          <DemoLink className="ml-1 hidden rounded-full px-4 sm:inline-flex" />
          <AuthButton authenticated={authenticated} className="ml-1 rounded-full px-4" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden hover:bg-muted hover:text-foreground"
                aria-label={t("Buka menu")}
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-72 max-w-[85vw] overflow-y-auto overscroll-contain pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            >
              <SheetTitle className="font-display">{t("Menu")}</SheetTitle>
              <SheetDescription className="sr-only">{t("Navigasi halaman")}</SheetDescription>
              <nav aria-label={t("Navigasi halaman")} className="mt-6 flex flex-col gap-1">
                {LANDING_NAV.map((n) => (
                  <SectionLink
                    key={n.hash}
                    hash={n.hash}
                    onLanding={onLanding}
                    onClick={() => setOpen(false)}
                    className={cn(link, "text-base")}
                  >
                    {t(n.label)}
                  </SectionLink>
                ))}
                <a
                  href={repo}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(link, "flex items-center gap-2 text-base")}
                >
                  <Github className="size-4" /> GitHub
                </a>
              </nav>
              <DemoLink size="default" className="mt-4 w-full sm:hidden" />
              <div className="mt-6 flex items-center gap-1 border-t pt-4">
                <LangButton />
                <ThemeButton />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
