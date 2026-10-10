import { createFileRoute } from "@tanstack/react-router";
import { PRIVACY, PRIVACY_INTRO } from "@/components/legal/legal-content";
import { LegalPage } from "@/components/legal/legal-page";
import { pageHead } from "@/lib/head";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { isAuthenticated } from "@/components/landing/public-session";

export const Route = createFileRoute("/privacy")({
  beforeLoad: async () => ({ authenticated: await isAuthenticated() }),
  loader: ({ context }) => loadSeoConfig(context.queryClient),
  head: ({ loaderData }) =>
    pageHead(
      "Kebijakan Privasi",
      "Data apa yang disimpan instance Dompetku ini, di mana disimpan, dan layanan pihak ketiga yang mungkin dipakai.",
      { index: loaderData?.indexable ?? false, path: "/privacy", siteUrl: loaderData?.siteUrl },
    ),
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
