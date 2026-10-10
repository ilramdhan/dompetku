import { createFileRoute } from "@tanstack/react-router";
import { PRIVACY, PRIVACY_INTRO } from "@/components/legal/legal-content";
import { LegalPage } from "@/components/legal/legal-page";
import { pageHead } from "@/lib/head";
import { translate } from "@/lib/i18n";
import { DEFAULT_LANG, parseLang, validateLangSearch } from "@/lib/lang";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { isAuthenticated } from "@/components/landing/public-session";

export const Route = createFileRoute("/privacy")({
  validateSearch: validateLangSearch,
  beforeLoad: async () => ({ authenticated: await isAuthenticated() }),
  loader: ({ context }) => loadSeoConfig(context.queryClient),
  head: ({ loaderData, match }) => {
    // Re-parse: unvalidated params from the root route also reach `match.search`.
    const lang = parseLang(match.search.lang) ?? DEFAULT_LANG;
    return pageHead(
      translate("Kebijakan Privasi", lang),
      translate(
        "Data apa yang disimpan instance Dompetku ini, di mana disimpan, dan layanan pihak ketiga yang mungkin dipakai.",
        lang,
      ),
      {
        index: loaderData?.indexable ?? false,
        path: "/privacy",
        siteUrl: loaderData?.siteUrl,
        lang,
      },
    );
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  const { authenticated } = Route.useRouteContext();
  return (
    <LegalPage
      authenticated={authenticated}
      title="Kebijakan Privasi"
      intro={PRIVACY_INTRO}
      sections={PRIVACY}
    />
  );
}
