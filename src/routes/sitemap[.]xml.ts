import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// GET /sitemap.xml — the public pages (/, /privacy, /terms) as absolute URLs. Needs
// PUBLIC_SITE_URL (each self-hosted copy has its own domain); 404 without it or in demo mode.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: withErrorLogging("public:sitemap", async () => {
        const { seoConfig } = await import("@/lib/seo.server");
        const { sitemapXml } = await import("@/lib/seo");
        const cfg = seoConfig();
        if (!cfg.siteUrl || !cfg.indexable)
          return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        const { appBuildDate } = await import("@/lib/version");
        return new Response(sitemapXml(cfg.siteUrl, undefined, appBuildDate()), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }),
    },
  },
});
