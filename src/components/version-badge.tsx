import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ComponentProps } from "react";
import { useBranding } from "@/components/app-logo";
import { getLatestRelease } from "@/lib/version.functions";
import { useI18n } from "@/lib/i18n";
import { appCommit, appVersion, releaseUrl, repoFromUrl, shortVersion } from "@/lib/version";
import { cn } from "@/lib/utils";

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Latest GitHub release (null when unknown); fetched only after hydration, never retried. */
export function useLatestRelease() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return useQuery({
    queryKey: ["latest-release"],
    queryFn: () => getLatestRelease(),
    staleTime: SIX_HOURS,
    gcTime: SIX_HOURS,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: hydrated,
  }).data;
}

/** "owner/repo" for links: Settings `github_url`, else the upstream repo. */
export function useRepo(): string {
  return repoFromUrl(useBranding().github_url);
}

export type VersionBadgeVariant = "footer" | "hero" | "sidebar" | "settings";

/**
 * The running version linking to its release notes. Commit is shown muted on footer, sidebar
 * and settings; when a newer release exists, sidebar/settings show an "update available"
 * link and the footer only a subtle dot.
 */
export function VersionBadge(props: { variant: VersionBadgeVariant; className?: string }) {
  const { variant, className } = props;
  const { t } = useI18n();
  const repo = useRepo();
  const latest = useLatestRelease();
  const version = appVersion();
  const commit = appCommit();
  const showCommit = variant !== "hero" && !!commit;
  const newer = latest?.newer ? latest : null;
  const updateLabel = newer ? `${t("Update tersedia")}: v${newer.latest}` : "";

  const versionLink = (
    <a
      href={releaseUrl(repo, version)}
      target="_blank"
      rel="noopener noreferrer"
      className="num underline-offset-2 hover:text-foreground hover:underline focus-visible:underline"
      aria-label={`${t("Catatan rilis")} v${version}`}
      title={t("Catatan rilis")}
    >
      v{version}
    </a>
  );

  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5",
        variant === "hero"
          ? "rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          : "text-xs text-muted-foreground",
        className,
      )}
    >
      {versionLink}
      {showCommit ? (
        <span className="num text-muted-foreground" title={t("Commit")}>
          · {commit}
        </span>
      ) : null}
      {newer && variant === "footer" ? (
        <a
          href={newer.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-4 items-center justify-center"
          aria-label={updateLabel}
          title={updateLabel}
        >
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        </a>
      ) : null}
      {newer && (variant === "sidebar" || variant === "settings") ? (
        <a
          href={newer.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {updateLabel}
        </a>
      ) : null}
    </span>
  );
}

/**
 * Icon-rail variant: tiny "v1.0" label; spreads extra props/ref so it can sit inside a Radix
 * `TooltipTrigger asChild` that shows the full text.
 */
export function VersionRailLabel({ className, ...rest }: ComponentProps<"a">) {
  const repo = useRepo();
  const latest = useLatestRelease();
  const version = appVersion();
  const newer = latest?.newer ? latest : null;
  const full = useVersionText();
  return (
    <a
      {...rest}
      href={newer ? newer.url : releaseUrl(repo, version)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={full}
      className={cn(
        "num relative inline-flex min-h-6 items-center justify-center text-[10px] text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      v{shortVersion(version)}
      {newer ? (
        <span
          className="absolute -right-1.5 top-0 size-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
    </a>
  );
}

/** Full text for tooltips (icon rail). */
export function useVersionText(): string {
  const { t } = useI18n();
  const latest = useLatestRelease();
  const commit = appCommit();
  let s = `v${appVersion()}${commit ? ` · ${commit}` : ""}`;
  if (latest?.newer) s += ` — ${t("Update tersedia")}: v${latest.latest}`;
  return s;
}
