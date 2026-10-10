import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SeoConfig } from "@/lib/seo";
import { getSeoConfig } from "@/lib/seo.functions";

/** Fixed per deployment (env), so it never goes stale. */
export const seoQuery = () =>
  queryOptions({
    queryKey: ["seo"],
    queryFn: (): Promise<SeoConfig> => getSeoConfig(),
    staleTime: Infinity,
  });

/** On failure stay out of the index (the pre-#38 behaviour) rather than guess. */
export const SEO_FALLBACK: SeoConfig = { siteUrl: null, indexable: false };

/** Loader helper for public pages (landing, privacy, terms); never throws. */
export function loadSeoConfig(queryClient: QueryClient): Promise<SeoConfig> {
  return queryClient.ensureQueryData(seoQuery()).catch(() => SEO_FALLBACK);
}
