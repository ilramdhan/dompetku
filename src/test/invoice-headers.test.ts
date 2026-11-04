import { describe, expect, it } from "vitest";
import {
  PUBLIC_INVOICE_HEADERS,
  isPublicInvoicePath,
  publicInvoiceHeadersFor,
} from "@/lib/invoice-headers";

describe("public invoice headers", () => {
  it("matches only /i/<token> paths", () => {
    expect(isPublicInvoicePath("/i/abc123")).toBe(true);
    expect(isPublicInvoicePath("/i/abc123/")).toBe(true);
    expect(isPublicInvoicePath("/i")).toBe(false);
    expect(isPublicInvoicePath("/i/")).toBe(false);
    expect(isPublicInvoicePath("/invoices")).toBe(false);
    expect(isPublicInvoicePath("/api/public/i/x")).toBe(false);
  });
  it("sends no-store, no-referrer and noindex (also for unknown/revoked tokens)", () => {
    const h = publicInvoiceHeadersFor("/i/not-a-real-token");
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(h).toEqual(PUBLIC_INVOICE_HEADERS);
  });
  it("adds nothing elsewhere", () => {
    expect(publicInvoiceHeadersFor("/login")).toEqual({});
  });
});
