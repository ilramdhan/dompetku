import { createMiddleware } from "@tanstack/react-start";

/** Rejects server function calls without a valid session cookie. */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { readValidSession } = await import("./session.server");
  const s = await readValidSession();
  if (!s) throw new Error("Unauthorized");
  return next({ context: { user: s.u } });
});
