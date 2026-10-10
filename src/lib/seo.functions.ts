import { createServerFn } from "@tanstack/react-start";

/**
 * Public (no login): the instance's public site URL (env PUBLIC_SITE_URL), whether public
 * pages may be indexed (false on a DEMO_MODE instance) and the search-console verification
 * tokens (GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION, published in <meta> anyway).
 * Read by public route loaders for <head>.
 */
export const getSeoConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { seoConfig } = await import("./seo.server");
  return seoConfig();
});
