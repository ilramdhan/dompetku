/**
 * Pure, client-safe SEO helpers (issue #38): robots directives, absolute URLs, document head
 * tags, JSON-LD, sitemap.xml and robots.txt.
 *
 * Only the public pages (PUBLIC_PATHS) are indexable, and never on a demo instance
 * (DEMO_MODE=true). Everything else inherits the root `noindex, nofollow`. Canonical, og:url,
 * absolute og:image and the sitemap need the instance's own public origin (env PUBLIC_SITE_URL)
 * because every self-hosted copy lives on a different domain; without it they are omitted.
 */
import { DEFAULT_LANG, langHref, LANGS, ogLocale, otherLang, type Lang } from "./lang";
import { DEFAULT_REPO_URL } from "./landing";

export const ROBOTS_INDEX = "index, follow";
export const ROBOTS_NOINDEX = "noindex, nofollow";
export const OG_IMAGE = "/icons/og-image.png";
export const SITE_NAME = "Dompetku";
export const OG_LOCALE = "id_ID";
export const OG_LOCALE_ALT = "en_US";
/** Maintainer, for the JSON-LD `author` (the upstream project; self-hosted copies keep it). */
export const AUTHOR = { name: "ilramdhan", url: "https://github.com/ilramdhan" } as const;

/** Public, indexable pages listed in the sitemap. */
export const PUBLIC_PATHS = ["/", "/privacy", "/terms"] as const;

/** App paths kept out of crawlers (they redirect to /login anyway). */
export const PRIVATE_PATHS = [
  "/api/",
  "/_serverFn/",
  "/dashboard",
  "/transactions",
  "/accounts",
  "/budgets",
  "/debts",
  "/goals",
  "/gold",
  "/profile",
  "/receivables",
  "/recurring",
  "/rekap",
  "/reminders",
  "/reports",
  "/settings",
  "/subscriptions",
] as const;

/**
 * Normalises PUBLIC_SITE_URL to an origin (+ optional base path) without a trailing slash.
 * Only http(s) URLs without query/hash are accepted; anything else returns null.
 */
export function normalizeSiteUrl(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** `site` + `path` → absolute URL; already-absolute paths are returned unchanged. */
export function absoluteUrl(site: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = site.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return p === "/" ? `${base}/` : `${base}${p}`;
}

export function robotsContent(index: boolean): string {
  return index ? ROBOTS_INDEX : ROBOTS_NOINDEX;
}

export type SeoEnv = {
  PUBLIC_SITE_URL?: string | undefined;
  DEMO_MODE?: string | undefined;
  GOOGLE_SITE_VERIFICATION?: string | undefined;
  BING_SITE_VERIFICATION?: string | undefined;
};

export type SeoConfig = {
  /** Normalised PUBLIC_SITE_URL, or null when unset/invalid. */
  siteUrl: string | null;
  /** Public pages may be indexed (false on a demo instance). */
  indexable: boolean;
  /** Google Search Console token (env GOOGLE_SITE_VERIFICATION); null when unset or in demo. */
  googleVerification?: string | null;
  /** Bing Webmaster Tools token (env BING_SITE_VERIFICATION); null when unset or in demo. */
  bingVerification?: string | null;
};

/**
 * Search-console verification token: the bare `content` value (a full `<meta …>` tag pasted by
 * mistake is unwrapped). Only URL-safe token characters are accepted; anything else → null.
 */
export function verificationToken(s: string | null | undefined): string | null {
  let v = (s ?? "").trim();
  const m = /content\s*=\s*["']([^"']*)["']/i.exec(v);
  if (m) v = (m[1] ?? "").trim();
  return /^[A-Za-z0-9_\-.:=+/]{8,200}$/.test(v) ? v : null;
}

export function seoConfigFrom(env: SeoEnv): SeoConfig {
  const indexable = env.DEMO_MODE !== "true";
  return {
    siteUrl: normalizeSiteUrl(env.PUBLIC_SITE_URL),
    indexable,
    googleVerification: indexable ? verificationToken(env.GOOGLE_SITE_VERIFICATION) : null,
    bingVerification: indexable ? verificationToken(env.BING_SITE_VERIFICATION) : null,
  };
}

/** `google-site-verification` / `msvalidate.01` meta tags for the landing (never in demo). */
export function verificationMeta(cfg: SeoConfig): Meta[] {
  if (!cfg.indexable) return [];
  const meta: Meta[] = [];
  if (cfg.googleVerification)
    meta.push({ name: "google-site-verification", content: cfg.googleVerification });
  if (cfg.bingVerification) meta.push({ name: "msvalidate.01", content: cfg.bingVerification });
  return meta;
}

type Meta = Record<string, unknown>;
type Link = { rel: string; href: string; hrefLang?: string };

/** Absolute URL of `path` in `lang` (`/` for Indonesian, `/?lang=en` for English). */
export function langUrl(site: string, path: string, lang: Lang): string {
  return absoluteUrl(site, langHref(path, lang));
}

/** hreflang alternates for a public page: every language plus x-default (→ Indonesian). */
export function hreflangLinks(site: string, path: string): Link[] {
  return [
    ...LANGS.map((l) => ({ rel: "alternate", hrefLang: l, href: langUrl(site, path, l) })),
    { rel: "alternate", hrefLang: "x-default", href: langUrl(site, path, DEFAULT_LANG) },
  ];
}

export type SeoHeadInput = {
  title: string;
  description: string;
  /** Route path, used for canonical/og:url when a site URL is known. */
  path?: string | undefined;
  siteUrl?: string | null | undefined;
  /** true → `index, follow`; false → `noindex, nofollow`; undefined → inherit the root tag. */
  index?: boolean | undefined;
  /** Large preview card with the og-image (landing) instead of a plain summary card. */
  largeImage?: boolean | undefined;
  /** Page language (`?lang=` on public pages); drives og:locale, canonical and hreflang. */
  lang?: Lang | undefined;
};

/** Title/description/Open Graph/Twitter tags plus robots, canonical and og:url when applicable. */
export function seoHead(input: SeoHeadInput): { meta: Meta[]; links: Link[] } {
  const { title, description, path, index, largeImage } = input;
  const lang = input.lang ?? DEFAULT_LANG;
  const site = normalizeSiteUrl(input.siteUrl);
  const meta: Meta[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: ogLocale(lang) },
    { property: "og:locale:alternate", content: ogLocale(otherLang(lang)) },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (index !== undefined) meta.push({ name: "robots", content: robotsContent(index) });
  if (largeImage) {
    const img = site ? absoluteUrl(site, OG_IMAGE) : OG_IMAGE;
    meta.push(
      { property: "og:image", content: img },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: img },
    );
  } else {
    meta.push({ name: "twitter:card", content: "summary" });
  }
  const links: Link[] = [];
  if (site && path && index) {
    // Each language is its own canonical URL; hreflang ties the variants together.
    const url = langUrl(site, path, lang);
    meta.push({ property: "og:url", content: url });
    links.push({ rel: "canonical", href: url }, ...hreflangLinks(site, path));
  }
  return { meta, links };
}

/** schema.org SoftwareApplication for the landing page. */
export function softwareAppJsonLd(opts: {
  name?: string;
  description: string;
  siteUrl?: string | null | undefined;
  version?: string;
  lang?: Lang;
}): Record<string, unknown> {
  const site = normalizeSiteUrl(opts.siteUrl);
  const lang = opts.lang ?? DEFAULT_LANG;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name ?? SITE_NAME,
    description: opts.description,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, Android, iOS",
    inLanguage: lang,
    availableLanguage: [...LANGS],
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    codeRepository: DEFAULT_REPO_URL,
    sameAs: [DEFAULT_REPO_URL],
    author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
    offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
  };
  if (opts.version && opts.version !== "0.0.0") ld["softwareVersion"] = opts.version;
  if (site) {
    ld["url"] = langUrl(site, "/", lang);
    ld["image"] = absoluteUrl(site, OG_IMAGE);
  } else {
    ld["url"] = DEFAULT_REPO_URL;
  }
  return ld;
}

/** schema.org FAQPage from question/answer pairs already in `lang` (default Indonesian). */
export function faqJsonLd(
  faq: ReadonlyArray<{ q: string; a: string }>,
  lang: Lang = DEFAULT_LANG,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

const xmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * sitemap.xml for `paths` under `siteUrl`; `lastmod` is an optional ISO date. Every path is
 * listed once per language (`/`, `/?lang=en`), each with the full set of `xhtml:link` hreflang
 * alternates as Google requires.
 */
export function sitemapXml(
  siteUrl: string,
  paths: ReadonlyArray<string> = PUBLIC_PATHS,
  lastmod?: string,
): string {
  const day = lastmod && /^\d{4}-\d{2}-\d{2}/.test(lastmod) ? lastmod.slice(0, 10) : null;
  const urls = paths.flatMap((p) => {
    const alts = hreflangLinks(siteUrl, p)
      .map(
        (a) =>
          `<xhtml:link rel="alternate" hreflang="${a.hrefLang ?? ""}" href="${xmlEscape(a.href)}"/>`,
      )
      .join("");
    return LANGS.map((l) => {
      const loc = `<loc>${xmlEscape(langUrl(siteUrl, p, l))}</loc>`;
      const mod = day ? `<lastmod>${day}</lastmod>` : "";
      return `  <url>${loc}${mod}${alts}</url>`;
    });
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * robots.txt: a demo instance blocks everything; otherwise public pages are allowed, API and app
 * paths are disallowed, and a Sitemap line is added when the site URL is known.
 */
export function robotsTxt(cfg: SeoConfig): string {
  if (!cfg.indexable) return "User-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /", ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)];
  if (cfg.siteUrl) lines.push("", `Sitemap: ${absoluteUrl(cfg.siteUrl, "/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
}
