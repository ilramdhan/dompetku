/**
 * Server-only: SEO config from env (PUBLIC_SITE_URL, DEMO_MODE, GOOGLE_SITE_VERIFICATION,
 * BING_SITE_VERIFICATION). Pure logic lives in seo.ts.
 */
import { seoConfigFrom, type SeoConfig } from "./seo";

export function seoConfig(): SeoConfig {
  return seoConfigFrom({
    PUBLIC_SITE_URL: process.env["PUBLIC_SITE_URL"],
    DEMO_MODE: process.env["DEMO_MODE"],
    GOOGLE_SITE_VERIFICATION: process.env["GOOGLE_SITE_VERIFICATION"],
    BING_SITE_VERIFICATION: process.env["BING_SITE_VERIFICATION"],
  });
}
