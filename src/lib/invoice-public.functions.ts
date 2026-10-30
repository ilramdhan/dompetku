import { createServerFn } from "@tanstack/react-start";

/**
 * PUBLIC (no login, issue #93): the customer view of one invoice by its share token. This is the
 * first public surface that reads financial data, so it is deliberately tiny:
 * - input is only a string, truncated; anything but a well-formed token is rejected before any DB
 *   access (inside `publicInvoiceByToken`);
 * - the token is SHA-256 hashed and looked up by equality on the unique hash;
 * - every failure (unknown/revoked/expired token, draft/cancelled invoice, missing schema, DB
 *   error) returns the same `null`, which the route turns into the same 404;
 * - the result is the `toPublicInvoice()` whitelist (no wallet, notes, ids or payment references).
 */
export const getPublicInvoice = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => {
    const token = (d as { token?: unknown } | null)?.token;
    return { token: typeof token === "string" ? token.slice(0, 128) : "" };
  })
  .handler(async ({ data }) => {
    const { publicInvoiceByToken } = await import("./invoice-share.server");
    return publicInvoiceByToken(data.token);
  });
