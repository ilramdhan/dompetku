import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { FlaskConical, X } from "lucide-react";
import { useBranding } from "@/components/app-logo";
import { DEMO_DISABLED, type DemoInfo } from "@/lib/demo";
import { getDemoInfo } from "@/lib/demo.functions";
import { useI18n } from "@/lib/i18n";
import { docsUrl, repoUrl } from "@/lib/landing";

/** Public demo flag (+ demo login on demo instances). Fixed per deployment → never stale. */
export const demoQuery = () =>
  queryOptions({
    queryKey: ["demo"],
    queryFn: (): Promise<DemoInfo> => getDemoInfo(),
    staleTime: Infinity,
  });

export function useDemoInfo(): DemoInfo {
  return useQuery(demoQuery()).data ?? { demo: false };
}

export function useIsDemo(): boolean {
  return useDemoInfo().demo;
}

/**
 * Whole settings cards that are unavailable in demo mode: rendered read-only (a disabled
 * fieldset disables every control inside) with a short note. Off demo: children unchanged.
 */
export function DemoDisabled({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  if (!useIsDemo()) return <>{children}</>;
  return (
    <div title={t(DEMO_DISABLED)} className="min-w-0">
      <fieldset disabled aria-disabled="true" className="min-w-0 opacity-60">
        {children}
      </fieldset>
      <p className="mt-1 px-1 text-xs font-medium text-muted-foreground">{t(DEMO_DISABLED)}</p>
    </div>
  );
}

/**
 * Slim banner on top of the app shell in demo mode. Dismissal is plain component state, so it
 * lasts while navigating inside the app and the banner comes back on the next reload.
 */
export function DemoBanner() {
  const { t } = useI18n();
  const demo = useIsDemo();
  const b = useBranding();
  const [hidden, setHidden] = useState(false);
  if (!demo || hidden) return null;
  return (
    <div
      role="note"
      className="no-print flex items-center gap-2 bg-accent px-4 py-1.5 text-xs text-accent-foreground"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{t("Mode demo")}</span>
        {" · "}
        {t("Data direset setiap hari")}
        {" · "}
        <a
          href={docsUrl(repoUrl(b.github_url), "docs/SELF-HOSTING.md")}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline underline-offset-2"
        >
          {t("Install sendiri →")}
        </a>
      </p>
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label={t("Tutup banner demo")}
        className="-mr-1 rounded p-1 hover:bg-background/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
