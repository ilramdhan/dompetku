/**
 * Server-only: SEO config. PUBLIC_SITE_URL resolves as Settings → Integrasi (v16, #117) > env
 * (via getIntegration, ~60 s cache); DEMO_MODE, GOOGLE_SITE_VERIFICATION and
 * BING_SITE_VERIFICATION stay env-only. Pure logic lives in seo.ts.
 */
import { seoConfigFrom, type SeoConfig } from "./seo";

export async function seoConfig(): Promise<SeoConfig> {
  const { getIntegration } = await import("./integrations.server");
  return seoConfigFrom({
    PUBLIC_SITE_URL: await getIntegration("PUBLIC_SITE_URL"),
    DEMO_MODE: process.env["DEMO_MODE"],
    GOOGLE_SITE_VERIFICATION: process.env["GOOGLE_SITE_VERIFICATION"],
    BING_SITE_VERIFICATION: process.env["BING_SITE_VERIFICATION"],
  });
}
