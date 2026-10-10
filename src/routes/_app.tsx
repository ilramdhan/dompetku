import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth.functions";
import { canOpenPath } from "@/lib/permissions";
import { FONT_MONO, fontPreloads } from "@/lib/fonts";
import { clearSessionCache, getCachedSession, setCachedSession } from "@/lib/session-cache";

export const Route = createFileRoute("/_app")({
  // App pages render amounts (`.num`, JetBrains Mono) on first paint; the root preloads body/display only.
  head: () => ({ links: fontPreloads(FONT_MONO) }),
  beforeLoad: async ({ location }) => {
    let s = getCachedSession();
    if (!s) {
      const r = await getSession();
      if (!r.authenticated) {
        clearSessionCache();
        throw redirect({ to: "/login" });
      }
      const info = {
        role: r.role,
        displayName: r.displayName,
        mustChangePassword: r.mustChangePassword,
        wallets: r.wallets,
      };
      setCachedSession(r.user, Date.now(), info);
      s = { user: r.user, ...info };
    }
    // UI convenience only; every server fn enforces the same rules.
    if (s.mustChangePassword && location.pathname !== "/profile")
      throw redirect({ to: "/profile" });
    if (s.role === "member" && !canOpenPath("member", location.pathname))
      throw redirect({ to: "/dashboard" });
    return {
      user: s.user,
      role: s.role ?? "admin",
      displayName: s.displayName ?? null,
      mustChangePassword: !!s.mustChangePassword,
      wallets: s.wallets ?? null,
    };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
