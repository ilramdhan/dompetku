import { createFileRoute } from "@tanstack/react-router";
import { TERMS, TERMS_INTRO } from "@/components/legal/legal-content";
import { LegalPage } from "@/components/legal/legal-page";
import { pageHead } from "@/lib/head";
import { loadSeoConfig } from "@/components/landing/seo-config";
import { isAuthenticated } from "@/components/landing/public-session";

export const Route = createFileRoute("/terms")({
  beforeLoad: async () => ({ authenticated: await isAuthenticated() }),
  loader: ({ context }) => loadSeoConfig(context.queryClient),
  head: ({ loaderData }) =>
    pageHead(
      "Syarat & Ketentuan",
      "Ketentuan penggunaan Dompetku: lisensi MIT, tanpa jaminan, bukan nasihat keuangan.",
      { index: loaderData?.indexable ?? false, path: "/terms", siteUrl: loaderData?.siteUrl },
    ),
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
