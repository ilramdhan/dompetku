import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
import { clearSessionCache, isPasswordChangeError, isUnauthorizedError } from "./lib/session-cache";

export const getRouter = () => {
  // The client caches the session check (see _app.tsx); when a server fn
  // rejects with "Unauthorized" (expired/cleared cookie) drop that cache and
  // send the user back to /login.
  let redirecting = false;
  const onAuthError = (err: unknown) => {
    if (typeof window === "undefined") return;
    // v18: a member with a temporary password is sent to the forced password change.
    if (isPasswordChangeError(err)) {
      clearSessionCache();
      if (router.state.location.pathname !== "/profile") void router.navigate({ to: "/profile" });
      return;
    }
    if (!isUnauthorizedError(err)) return;
    clearSessionCache();
    if (redirecting || router.state.location.pathname === "/login") return;
    redirecting = true;
    void router.navigate({ to: "/login" }).finally(() => {
      redirecting = false;
    });
  };

  // Created inside getRouter, which TanStack Start calls once per SSR request, so the
  // server cache (per-user finance data) never leaks between requests.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // styles.css makes `scroll-behavior` smooth app-wide; route changes and restored
    // positions should still jump instantly instead of animating.
    scrollRestorationBehavior: "instant",
    // Loaders use ensureQueryData, so React Query owns freshness; this only
    // stops hover-preloaded routes from re-running their loaders right away.
    defaultPreloadStaleTime: 30_000,
    defaultPreload: "intent",
  });

  // Dehydrates the server QueryClient (loader ensureQueryData/prefetch results) into the
  // SSR stream and hydrates it on the client, so the first client render matches the
  // server HTML (no React #418, no refetch of data the loader already fetched). It also
  // wraps the app in QueryClientProvider and clears the server cache after the request.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
};
