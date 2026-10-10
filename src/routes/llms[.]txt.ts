import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/monitoring";

// GET /llms.txt — Markdown overview for AI assistants / generative search (llmstxt.org), built
// by the pure llmsTxt() in llms.ts. 404 in demo mode, like the sitemap.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: withErrorLogging("public:llms", async () => {
        const { seoConfig } = await import("@/lib/seo.server");
        const cfg = seoConfig();
        if (!cfg.indexable)
          return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        const [{ llmsTxt }, { getBranding }] = await Promise.all([
          import("@/lib/llms"),
          import("@/lib/app-settings.server"),
        ]);
        const b = await getBranding();
        const body = llmsTxt({
          appName: b.app_name,
          siteUrl: cfg.siteUrl,
          repo: b.github_url,
          demoUrl: b.demo_url,
        });
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }),
    },
  },
});
