/*
 * Headers for the public invoice page `/i/<token>` (issues #93, #119). The route's own `headers()`
 * only applies when its loader succeeds, so the 404 for an unknown/revoked token would miss them;
 * `start.ts` applies these to every response of that path (success and 404 alike).
 */
export const PUBLIC_INVOICE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

/** True for `/i/<token>` (and `/i/<token>/…`), false for `/i`, `/invoices` or `/api/…`. */
export function isPublicInvoicePath(pathname: string): boolean {
  return /^\/i\/[^/]+/.test(pathname);
}

/** Headers to force on this path ({} elsewhere). */
export function publicInvoiceHeadersFor(pathname: string): Record<string, string> {
  return isPublicInvoicePath(pathname) ? PUBLIC_INVOICE_HEADERS : {};
}
