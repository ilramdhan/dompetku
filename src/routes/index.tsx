import { createFileRoute, redirect } from "@tanstack/react-router";
import { brandingQuery } from "@/components/app-logo";
import { LandingPage } from "@/components/landing/landing-page";
import { isAuthenticated } from "@/components/landing/public-session";
import { DEFAULT_BRANDING } from "@/lib/app-settings";
import { LANDING_FAQ, landingRedirect } from "@/lib/landing";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { faqJsonLd, seoHead, softwareAppJsonLd } from "@/lib/seo";
import { appVersion } from "@/lib/version";

// Keyword-rich (Indonesian + English) for search results; the visible H1 is unchanged.
const TITLE = "Dompetku — Pencatat Keuangan Open Source & Self-Hosted Expense Tracker";
const DESCRIPTION =
  "Aplikasi pencatat keuangan pribadi gratis & open source: catat pengeluaran lewat bot Telegram, OCR struk, budget dan laporan. Self-hosted personal expense tracker.";

export const Route = createFileRoute("/")({
  // Indexable public page (noindex on a demo instance). Canonical/og:url/absolute og:image only
  // when PUBLIC_SITE_URL is set — each self-hosted copy has its own domain.
  beforeLoad: async ({ context }) => {
    const [branding, authenticated] = await Promise.all([
      context.queryClient.ensureQueryData(brandingQuery()).catch(() => DEFAULT_BRANDING),
      isAuthenticated(),
    ]);
    const to = landingRedirect({ enabled: branding.landing_enabled, authenticated });
    if (to) throw redirect({ to });
    return { authenticated };
  },
  loader: ({ context }) => loadSeoConfig(context.queryClient),
  head: ({ loaderData }) => {
    const seo = loaderData ?? { siteUrl: null, indexable: false };
    const head = seoHead({
      title: TITLE,
      description: DESCRIPTION,
      path: "/",
      siteUrl: seo.siteUrl,
      index: seo.indexable,
      largeImage: true,
    });
    if (!seo.indexable) return head;
    return {
      ...head,
      meta: [
        ...head.meta,
        {
          "script:ld+json": softwareAppJsonLd({
            description: DESCRIPTION,
            siteUrl: seo.siteUrl,
            version: appVersion(),
          }),
        },
        { "script:ld+json": faqJsonLd(LANDING_FAQ) },
      ],
    };
  },
  component: Landing,
});

function Landing() {
  const { authenticated } = Route.useRouteContext();
  return <LandingPage authenticated={authenticated} />;
}
