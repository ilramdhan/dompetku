import { createFileRoute, redirect } from "@tanstack/react-router";
import { brandingQuery } from "@/components/app-logo";
import { LandingPage } from "@/components/landing/landing-page";
import { isAuthenticated } from "@/components/landing/public-session";
import { DEFAULT_BRANDING } from "@/lib/app-settings";
import { LANDING_FAQ, landingRedirect } from "@/lib/landing";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { translate } from "@/lib/i18n";
import { DEFAULT_LANG, parseLang, validateLangSearch } from "@/lib/lang";
import { faqJsonLd, seoHead, softwareAppJsonLd } from "@/lib/seo";
import { appVersion } from "@/lib/version";

// Keyword-rich (Indonesian + English) for search results; the visible H1 is unchanged. Both are
// DICT keys, so `/?lang=en` gets the English title/description.
const TITLE = "Dompetku — Pencatat Keuangan Open Source & Self-Hosted Expense Tracker";
const DESCRIPTION =
  "Aplikasi pencatat keuangan pribadi gratis & open source: catat pengeluaran lewat bot Telegram, OCR struk, budget dan laporan. Self-hosted personal expense tracker.";

export const Route = createFileRoute("/")({
  // `?lang=en|id` server-renders that language (issue #44); invalid values are dropped.
  validateSearch: validateLangSearch,
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
  head: ({ loaderData, match }) => {
    const seo = loaderData ?? { siteUrl: null, indexable: false };
    // Re-parse: unvalidated params from the root route also reach `match.search`.
    const lang = parseLang(match.search.lang) ?? DEFAULT_LANG;
    const description = translate(DESCRIPTION, lang);
    const head = seoHead({
      title: translate(TITLE, lang),
      description,
      path: "/",
      siteUrl: seo.siteUrl,
      index: seo.indexable,
      largeImage: true,
      lang,
    });
    if (!seo.indexable) return head;
    const faq = LANDING_FAQ.map((f) => ({ q: translate(f.q, lang), a: translate(f.a, lang) }));
    return {
      ...head,
      meta: [
        ...head.meta,
        {
          "script:ld+json": softwareAppJsonLd({
            description,
            siteUrl: seo.siteUrl,
            version: appVersion(),
            lang,
          }),
        },
        { "script:ld+json": faqJsonLd(faq, lang) },
      ],
    };
  },
  component: Landing,
});

function Landing() {
  const { authenticated } = Route.useRouteContext();
  return <LandingPage authenticated={authenticated} />;
}
