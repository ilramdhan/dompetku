import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { signatureMatches } from "@/lib/gateway/midtrans.server";
import { validateIntegration, resolveIntegration } from "@/lib/integrations";
import { SERVER_FN_ACCESS } from "@/lib/server-fn-access";
import { RESTORE_TABLES, SECRET_COLUMNS, stripSecrets } from "@/lib/backup";
import { activityLabel } from "@/lib/activity";

const KEY = "SB-Mid-server-TEST_ONLY_not_a_real_key";
const sha512 = (s: string) => createHash("sha512").update(s, "utf8").digest("hex");

describe("midtrans webhook signature (server)", () => {
  it("verifies SHA512(order_id + status_code + gross_amount + server key) in constant time", () => {
    const n = {
      order_id: "INV-1-abc",
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: sha512(`INV-1-abc200150000.00${KEY}`),
    };
    expect(signatureMatches(n, KEY)).toBe(true);
    // Another key, another amount format or a tampered field fails.
    expect(signatureMatches(n, `${KEY}x`)).toBe(false);
    expect(signatureMatches({ ...n, gross_amount: "150000" }, KEY)).toBe(false);
    expect(signatureMatches({ ...n, status_code: "201" }, KEY)).toBe(false);
    expect(signatureMatches({ ...n, signature_key: "ab" }, KEY)).toBe(false);
  });
});

describe("v25 wiring", () => {
  it("adds Midtrans keys to the integration catalog", () => {
    expect(validateIntegration("MIDTRANS_ENABLED", "TRUE")).toEqual({ ok: true, value: "true" });
    expect(validateIntegration("MIDTRANS_ENABLED", "yes").ok).toBe(false);
    expect(validateIntegration("MIDTRANS_SERVER_KEY", KEY).ok).toBe(true);
    expect(validateIntegration("MIDTRANS_SERVER_KEY", "has space key").ok).toBe(false);
    expect(resolveIntegration("MIDTRANS_PRODUCTION", null, undefined)).toEqual({
      value: "false",
      source: "default",
    });
  });
  it("classifies the new server fns (public only for createGatewayPayment)", () => {
    expect(SERVER_FN_ACCESS["invoice-public.functions.ts"]!["createGatewayPayment"]).toBe("public");
    const inv = SERVER_FN_ACCESS["invoices.functions.ts"]!;
    for (const f of ["getGatewayTransactionsFn", "syncGatewayFn", "refundGatewayFn"])
      expect(inv[f]).toBe("admin");
  });
  it("backs up gateway_transactions after its parents, without Snap tokens", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    expect(i("gateway_transactions")).toBeGreaterThan(i("invoices"));
    expect(i("gateway_transactions")).toBeGreaterThan(i("invoice_payments"));
    expect(SECRET_COLUMNS.gateway_transactions).toEqual(["snap_token", "redirect_url"]);
    const [r] = stripSecrets("gateway_transactions", [
      { id: "1", order_id: "o", snap_token: "t", redirect_url: "u" },
    ]);
    expect(r).toEqual({ id: "1", order_id: "o" });
  });
  it("labels the gateway activity", () => {
    expect(activityLabel("invoices.gateway")).toBe("Pembayaran Midtrans diterima");
    expect(activityLabel("invoices.gateway_refund")).toBe("Refund Midtrans dicatat");
  });
});
