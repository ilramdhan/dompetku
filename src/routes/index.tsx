import { createFileRoute, redirect } from "@tanstack/react-router";
import { brandingQuery } from "@/components/app-logo";
import { LandingPage } from "@/components/landing/landing-page";
import { isAuthenticated } from "@/components/landing/public-session";
import { DEFAULT_BRANDING } from "@/lib/app-settings";
import { landingRedirect } from "@/lib/landing";

const TITLE = "Dompetku — Pelacak Keuangan Pribadi Open Source";
const DESCRIPTION =
  "Pelacak keuangan pribadi yang Anda host sendiri: transaksi, budget, hutang, emas, laporan, dan bot Telegram dengan OCR struk. Gratis dan open source.";

export const Route = createFileRoute("/")({
  // Public page: no canonical (each self-hosted copy has its own domain); og:image is relative.
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/icons/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
  }),
  beforeLoad: async ({ context }) => {
    const [branding, authenticated] = await Promise.all([
      context.queryClient.ensureQueryData(brandingQuery()).catch(() => DEFAULT_BRANDING),
      isAuthenticated(),
    ]);
    const to = landingRedirect({ enabled: branding.landing_enabled, authenticated });
    if (to) throw redirect({ to });
    return { authenticated };
  },
  component: Landing,
});

function Landing() {
  const { authenticated } = Route.useRouteContext();
  return <LandingPage authenticated={authenticated} />;
}
