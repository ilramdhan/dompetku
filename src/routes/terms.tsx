import { createFileRoute } from "@tanstack/react-router";
import { TERMS, TERMS_INTRO } from "@/components/legal/legal-content";
import { LegalPage } from "@/components/legal/legal-page";
import { pageHead } from "@/lib/head";
import { translate } from "@/lib/i18n";
import { DEFAULT_LANG, parseLang, validateLangSearch } from "@/lib/lang";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { isAuthenticated } from "@/components/landing/public-session";

export const Route = createFileRoute("/terms")({
  validateSearch: validateLangSearch,
  beforeLoad: async () => ({ authenticated: await isAuthenticated() }),
  loader: ({ context }) => loadSeoConfig(context.queryClient),
  head: ({ loaderData, match }) => {
    // Re-parse: unvalidated params from the root route also reach `match.search`.
    const lang = parseLang(match.search.lang) ?? DEFAULT_LANG;
    return pageHead(
      translate("Syarat & Ketentuan", lang),
      translate(
        "Ketentuan penggunaan Dompetku: lisensi MIT, tanpa jaminan, bukan nasihat keuangan.",
        lang,
      ),
      {
        index: loaderData?.indexable ?? false,
        path: "/terms",
        siteUrl: loaderData?.siteUrl,
        lang,
      },
    );
  },
  component: TermsPage,
});

function TermsPage() {
  const { authenticated } = Route.useRouteContext();
  return (
    <LegalPage
      authenticated={authenticated}
      title="Syarat & Ketentuan"
      intro={TERMS_INTRO}
      sections={TERMS}
    />
  );
}
