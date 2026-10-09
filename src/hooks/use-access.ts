import { useRouteContext } from "@tanstack/react-router";
import { can, type Access, type Level, type Permission } from "@/lib/permissions";

/**
 * The signed-in user's role and wallet levels from the `_app` route context (v18). UI
 * convenience only — hides buttons/links; every server fn enforces the same rules.
 */
export function useAccess() {
  const ctx = useRouteContext({ strict: false }) as {
    role?: "admin" | "member";
    wallets?: Record<string, Level> | null;
    displayName?: string | null;
    user?: string | null;
  };
  const role = ctx.role ?? "admin";
  const access: Access = { role, grants: ctx.wallets ?? {} };
  return {
    role,
    isAdmin: role === "admin",
    access,
    displayName: ctx.displayName ?? null,
    can: (p: Permission, resource?: string | null) => can(access, p, resource),
  };
}
