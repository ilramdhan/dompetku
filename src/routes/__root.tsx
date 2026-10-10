import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { LanguageProvider, useI18n } from "@/lib/i18n";
import { DEFAULT_LANG, urlLangFor, type Lang } from "@/lib/lang";
import { PrivacySync } from "@/lib/privacy-sync";
import { BrandingSync } from "@/components/app-logo";

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {t("Halaman tidak ditemukan")}
        </h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Kembali")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("Halaman gagal dimuat")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            {t("Coba lagi")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Dompetku — Pelacak Keuangan Pribadi" },
      {
        name: "description",
        content: "Catat pemasukan, pengeluaran, cicilan, dan langganan dalam satu tempat.",
      },
      // Default for every page (app, login, 404). Public pages (/, /privacy, /terms) override it
      // with "index, follow" via seo.ts — except on a demo instance.
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/icons/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/icons/og-image.png" },
    ],
    links: [
      // Self-hosted fonts (@font-face in styles.css); preload the latin subsets used on every page.
      ...[
        "figtree-latin-wght-normal",
        "bricolage-grotesque-latin-opsz-normal",
        "jetbrains-mono-latin-wght-normal",
      ].map((f) => ({
        rel: "preload",
        href: `/fonts/${f}.woff2`,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/logo.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/icons/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/icons/favicon-48.png" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** `?lang=` on a public page (/, /privacy, /terms); undefined elsewhere (the app ignores it). */
function useUrlLang(): Lang | undefined {
  return useRouterState({
    select: (s) => urlLangFor(s.location.pathname, s.location.search as Record<string, unknown>),
  });
}

function RootShell({ children }: { children: ReactNode }) {
  // Server-rendered from the URL so crawlers see the right language; a stored `dk-lang` without
  // a URL param is applied client-side by LanguageProvider (unchanged behaviour).
  const lang = useUrlLang() ?? DEFAULT_LANG;
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
        <meta name="theme-color" content="#1d3b2f" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('dk-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');if(localStorage.getItem('dk-privacy')==='1')document.documentElement.classList.add('privacy')}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const urlLang = useUrlLang();

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider urlLang={urlLang}>
        <PrivacySync />
        <BrandingSync />
        <Outlet />
        <Toaster richColors position="top-center" />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
