/**
 * Pure, client-safe helpers for the running app version. The values come from build-time
 * `define`s in vite.config.ts (package.json "version" + short commit SHA); the `typeof`
 * guards keep vitest and any non-Vite runtime working with safe fallbacks.
 */

export const DEFAULT_REPO = "ilramdhan/dompetku";

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "0.0.0";
}

export function appCommit(): string {
  return typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "";
}

/** ISO build timestamp, or "" when unknown. */
export function appBuildDate(): string {
  return typeof __APP_BUILD_DATE__ === "string" ? __APP_BUILD_DATE__ : "";
}

/** "v1.0.0 · a349e4c"; `short` drops the commit, `version`/`commit` override the build values. */
export function formatVersion(
  opts: { short?: boolean; version?: string; commit?: string } = {},
): string {
  const v = `v${stripV(opts.version ?? appVersion())}`;
  const c = opts.commit ?? appCommit();
  return opts.short || !c ? v : `${v} · ${c}`;
}

/** "1.0" for tight spaces (icon rail). */
export function shortVersion(version: string = appVersion()): string {
  return stripV(version).split(".").slice(0, 2).join(".");
}

function stripV(v: string): string {
  return v.trim().replace(/^v/i, "");
}

type Parsed = { nums: [number, number, number]; pre: string[] };

function parseSemver(v: string): Parsed | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(stripV(v));
  if (!m) return null;
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Semver ordering (-1 / 0 / 1); a leading "v" is ignored, pre-releases sort below the release.
 * Unparseable versions sort lowest.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const d = pa.nums[i]! - pb.nums[i]!;
    if (d) return d > 0 ? 1 : -1;
  }
  if (!pa.pre.length || !pb.pre.length) {
    return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  }
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return d > 0 ? 1 : -1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** True only when `latest` is a valid semver strictly greater than `current`. */
export function isNewer(
  latest: string | null | undefined,
  current: string = appVersion(),
): boolean {
  if (!latest || !parseSemver(latest)) return false;
  return compareSemver(latest, current) > 0;
}

/** "owner/repo" from a GitHub URL (Settings `github_url`), else the upstream repo. */
export function repoFromUrl(url: string | null | undefined): string {
  if (!url) return DEFAULT_REPO;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "github.com") return DEFAULT_REPO;
    const [owner, name] = u.pathname.split("/").filter(Boolean);
    const repo = name?.replace(/\.git$/i, "");
    const ok = /^[A-Za-z0-9_.-]+$/;
    return owner && repo && ok.test(owner) && ok.test(repo) ? `${owner}/${repo}` : DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

export function repoHomeUrl(repo: string = DEFAULT_REPO): string {
  return `https://github.com/${repo}`;
}

export function releaseUrl(repo: string = DEFAULT_REPO, version: string = appVersion()): string {
  return `${repoHomeUrl(repo)}/releases/tag/v${stripV(version)}`;
}

export function changelogUrl(repo: string = DEFAULT_REPO): string {
  return `${repoHomeUrl(repo)}/blob/main/CHANGELOG.md`;
}

export function issuesNewUrl(repo: string = DEFAULT_REPO): string {
  return `${repoHomeUrl(repo)}/issues/new/choose`;
}

export function docsHomeUrl(repo: string = DEFAULT_REPO): string {
  return `${repoHomeUrl(repo)}/tree/main/docs`;
}

export type LatestRelease = { latest: string; url: string; newer: boolean };

/** Shapes the GitHub "latest release" JSON; null when it has no usable tag. */
export function parseLatestRelease(
  json: unknown,
  repo: string,
  current: string = appVersion(),
): LatestRelease | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const tag = typeof o["tag_name"] === "string" ? stripV(o["tag_name"]) : "";
  if (!parseSemver(tag)) return null;
  const html = typeof o["html_url"] === "string" ? o["html_url"] : "";
  const url = html.startsWith("https://github.com/") ? html : releaseUrl(repo, tag);
  return { latest: tag, url, newer: isNewer(tag, current) };
}
