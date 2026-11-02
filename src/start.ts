import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { publicInvoiceHeadersFor } from "./lib/invoice-headers";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    try {
      const { logError } = await import("./lib/monitoring.server");
      logError("ssr:middleware", error, { request });
    } catch {
      console.error(error);
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Baseline security headers. Set in place on whatever response comes back
// (page, server fn, API route, error page) and return the result untouched so
// streaming/body ownership is unaffected. No X-Frame-Options/frame-ancestors
// (Lovable previews run in an iframe) and no CSP on purpose.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

const securityHeadersMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const res: unknown =
    result instanceof Response ? result : (result as { response?: unknown } | undefined)?.response;
  if (res instanceof Response) {
    // Public invoice page: its 404 (bad/revoked token) must be as uncached as the 200 (#119).
    let pathname = "";
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      // ignore: no path-specific headers
    }
    for (const [k, v] of Object.entries(publicInvoiceHeadersFor(pathname))) {
      try {
        res.headers.set(k, v);
      } catch {
        // Immutable headers: skip.
      }
    }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      try {
        if (!res.headers.has(k)) res.headers.set(k, v);
      } catch {
        // Immutable headers (e.g. Response.redirect): skip rather than fail.
      }
    }
  }
  return result;
});

// DEMO_MODE=true only: per-IP sliding-window limit on server-function writes (POST). The
// counter is in memory, so each serverless instance limits separately. No-op otherwise.
const demoRateLimitMiddleware = createMiddleware().server(
  async ({ next, request, handlerType }) => {
    if (process.env["DEMO_MODE"] === "true") {
      const { demoRateLimit } = await import("./lib/demo.server");
      const limited = demoRateLimit(request, handlerType);
      if (limited) return limited;
    }
    return next();
  },
);

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeadersMiddleware,
    errorMiddleware,
    csrfMiddleware,
    demoRateLimitMiddleware,
  ],
}));
