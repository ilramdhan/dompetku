import { createMiddleware } from "@tanstack/react-start";
import { can as canFor, type Access, type Permission } from "./permissions";

/** Error message for members who still have to replace their temporary password. */
export const PASSWORD_CHANGE_REQUIRED = "PasswordChangeRequired";

export type AuthContext = {
  /** Username (owner: APP_USERNAME). */
  user: string;
  /** app_users.id; null for the owner without a v17 row. */
  userId: string | null;
  role: "admin" | "member";
  access: Access;
  can: (permission: Permission, resource?: string | null) => boolean;
};

async function principalContext(allowPendingPassword: boolean) {
  const { readPrincipal } = await import("./session.server");
  const p = await readPrincipal();
  if (!p) throw new Error("Unauthorized");
  if (p.mustChangePassword && !allowPendingPassword) throw new Error(PASSWORD_CHANGE_REQUIRED);
  const ctx: AuthContext = {
    user: p.username,
    userId: p.userId,
    role: p.role,
    access: p.access,
    can: (permission, resource) => canFor(p.access, permission, resource),
  };
  return ctx;
}

/**
 * Rejects server function calls without a valid session cookie. Context: `{ user, userId, role,
 * access, can }`. Members who must change their temporary password are refused here (only
 * `requireSession` fns — profile, password change — accept them). The handler runs with the
 * actor in AsyncLocalStorage so activity_log records who acted.
 */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const ctx = await principalContext(false);
  const { runAsActor } = await import("./request-context.server");
  return runAsActor({ username: ctx.user, role: ctx.role }, () => next({ context: ctx }));
});

/** Like requireAuth but also accepts a member who still has to change the temporary password. */
export const requireSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const ctx = await principalContext(true);
  const { runAsActor } = await import("./request-context.server");
  return runAsActor({ username: ctx.user, role: ctx.role }, () => next({ context: ctx }));
});

/** Admin-only server functions (owner). Members get "Akses ditolak". */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireAuth])
  .server(async ({ next, context }) => {
    if (context.role !== "admin") throw new Error("Akses ditolak");
    return next();
  });
