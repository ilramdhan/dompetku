/** Pure, client-safe helpers for the public landing page at `/`. */

export const DEFAULT_REPO_URL = "https://github.com/ilramdhan/dompetku";

export type LandingRedirect = "/login" | "/dashboard" | null;

/**
 * Where `/` should go: null renders the landing page; when the landing page is switched off
 * in Settings, signed-in users land on the dashboard and everyone else on the login page.
 */
export function landingRedirect({
  enabled,
  authenticated,
}: {
  enabled: boolean;
  authenticated: boolean;
}): LandingRedirect {
  if (enabled) return null;
  return authenticated ? "/dashboard" : "/login";
}

/** The repository link shown on the landing page (Settings `github_url`, else the upstream repo). */
export function repoUrl(url: string | null | undefined): string {
  if (!url) return DEFAULT_REPO_URL;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return DEFAULT_REPO_URL;
    return u.href.replace(/\/+$/, "");
  } catch {
    return DEFAULT_REPO_URL;
  }
}

/** Link to a file in the repo's docs folder; non-GitHub repos fall back to the upstream docs. */
export function docsUrl(repo: string, file: string): string {
  const base = /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo) ? repo : DEFAULT_REPO_URL;
  return `${base}/blob/main/${file}`;
}

/** Screenshot files expected in public/screenshots (`<name>.png` and `<name>-dark.png`). */
export const SCREENSHOTS = [
  "dashboard",
  "dashboard-mobile",
  "transactions",
  "budgets",
  "reports",
  "accounts-detail",
  "goals",
  "gold",
  "recurring",
  "settings",
  "telegram-bot",
] as const;
export type ScreenshotName = (typeof SCREENSHOTS)[number];

export function screenshotSrc(name: ScreenshotName, dark = false): string {
  return `/screenshots/${name}${dark ? "-dark" : ""}.png`;
}
