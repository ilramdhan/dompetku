/**
 * Pure, client-safe helpers for picking the UI language from the URL (issue #44).
 *
 * Public pages (`/`, `/privacy`, `/terms`) accept `?lang=en` / `?lang=id` so each language has a
 * crawlable, server-rendered URL. An explicit URL param wins over the stored choice (localStorage
 * `dk-lang`); without one the stored choice applies after hydration, exactly as before. The
 * authenticated app ignores the param.
 */
export type Lang = "id" | "en";

export const LANGS: ReadonlyArray<Lang> = ["id", "en"];
/** Source language and the hreflang x-default target. */
export const DEFAULT_LANG: Lang = "id";
/** localStorage key used by the language switcher. */
export const LANG_STORAGE_KEY = "dk-lang";

/** Pages that honour `?lang=` (and get hreflang alternates). */
export const LANG_PATHS = ["/", "/privacy", "/terms"] as const;

/** "en"/"id" (any case, surrounding spaces ignored) → Lang; anything else → undefined. */
export function parseLang(v: unknown): Lang | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return s === "en" || s === "id" ? s : undefined;
}

export type LangSearch = { lang?: Lang };

/** Route `validateSearch` for public pages: keeps only a valid `lang`, drops everything else. */
export function validateLangSearch(search: Record<string, unknown>): LangSearch {
  const lang = parseLang(search["lang"]);
  return lang ? { lang } : {};
}

/** Strips a trailing slash (except for "/") and any query/hash. */
function cleanPath(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] ?? "/") || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

/** True for public pages where `?lang=` is honoured. */
export function isLangPath(pathname: string): boolean {
  return (LANG_PATHS as ReadonlyArray<string>).includes(cleanPath(pathname));
}

/** The language requested by the URL, only on public pages (the app ignores `?lang=`). */
export function urlLangFor(pathname: string, search: Record<string, unknown>): Lang | undefined {
  return isLangPath(pathname) ? parseLang(search["lang"]) : undefined;
}

/** Explicit URL language wins, then the stored choice, then Indonesian. */
export function resolveLang(urlLang: Lang | undefined, stored: unknown): Lang {
  return urlLang ?? parseLang(stored) ?? DEFAULT_LANG;
}

/**
 * The canonical URL path of `path` in `lang`: Indonesian has no param (`/`), English is
 * `/?lang=en`. An optional `#hash` is kept so switching language stays on the same section.
 */
export function langHref(path: string, lang: Lang, hash?: string): string {
  const p = cleanPath(path);
  const h = hash ? `#${hash.replace(/^#/, "")}` : "";
  return lang === DEFAULT_LANG ? `${p}${h}` : `${p}?lang=${lang}${h}`;
}

/** Search params for a link to a public page in `lang` (none for Indonesian). */
export function langSearch(lang: Lang): LangSearch {
  return lang === DEFAULT_LANG ? {} : { lang };
}

/** Open Graph locale for a language. */
export function ogLocale(lang: Lang): string {
  return lang === "en" ? "en_US" : "id_ID";
}

export function otherLang(lang: Lang): Lang {
  return lang === "en" ? "id" : "en";
}
