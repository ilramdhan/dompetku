import { createServerFn } from "@tanstack/react-start";

/**
 * Public (no login): the instance's public site URL (env PUBLIC_SITE_URL) and whether public
 * pages may be indexed (false on a DEMO_MODE instance). Read by public route loaders for <head>.
 */
export const getSeoConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { seoConfig } = await import("./seo.server");
  return seoConfig();
});
