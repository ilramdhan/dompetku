import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// GET /robots.txt — dynamic so a demo instance (DEMO_MODE=true) can block every crawler and a
// main instance can advertise its sitemap when PUBLIC_SITE_URL is set. Rules live in seo.ts.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: withErrorLogging("public:robots", async () => {
        const { seoConfig } = await import("@/lib/seo.server");
        const { robotsTxt } = await import("@/lib/seo");
        return new Response(robotsTxt(seoConfig()), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }),
    },
  },
});
