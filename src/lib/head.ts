import type { Lang } from "./lang";
import { seoHead } from "./seo";

export type PageHeadOptions = {
  /** true → `index, follow` (public pages); omitted → inherit the root `noindex, nofollow`. */
  index?: boolean | undefined;
  /** Route path for canonical/og:url (only emitted with `index` and a site URL). */
  path?: string | undefined;
  /** Normalised PUBLIC_SITE_URL (from `getSeoConfig`), or null. */
  siteUrl?: string | null | undefined;
  /** Page language (`?lang=` on public pages): og:locale, canonical and hreflang. */
  lang?: Lang | undefined;
};

export function pageHead(title: string, description: string, opts: PageHeadOptions = {}) {
  return seoHead({ title: `${title} — Dompetku`, description, ...opts });
}
