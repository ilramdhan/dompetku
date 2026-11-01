import { describe, expect, it } from "vitest";
import type { InvoiceStatus } from "@/lib/invoices";
import {
  formatMdrRules,
  mdrExternalId,
  mdrFee,
  mdrRulesProblem,
  parseMdrRules,
} from "@/lib/gateway/mdr";
import {
  GATEWAY_MIN_PARTIAL,
  chargeAmount,
  EXPIRY_GRACE_MS,
  ORDER_EXPIRY_MIN,
  TOKENLESS_GRACE_MS,
  parseRequestedAmount,
  partialAllowed,
  pendingAgedOut,
} from "@/lib/gateway/types";
import { validateIntegration, resolveIntegration } from "@/lib/integrations";
import { paymentProblem, derivedStatus } from "@/lib/invoices";

describe("MDR schedule (#124)", () => {
  it("parses percent, flat, both and a wildcard", () => {
    const r = parseMdrRules(
      "QRIS = 0.7 %; gopay=2%; credit_card=2.9%+2000; bank_transfer=4000; *=0",
    );
    expect(r).toEqual({
      ok: true,
      rules: {
        qris: { percent: 0.7, flat: 0 },
        gopay: { percent: 2, flat: 0 },
        credit_card: { percent: 2.9, flat: 2000 },
        bank_transfer: { percent: 0, flat: 4000 },
        "*": { percent: 0, flat: 0 },
      },
    });
    expect(parseMdrRules("")).toEqual({ ok: true, rules: {} });
  });

  it("refuses malformed entries and absurd rates", () => {
    for (const bad of ["qris", "qris=", "qris=abc", "qris=60%", "q r=1%", "qris=2.9%2000", "=1%"])
      expect(mdrRulesProblem(bad), bad).not.toBeNull();
    expect(mdrRulesProblem("qris=0.7%")).toBeNull();
  });

  it("normalises the stored value", () => {
    expect(formatMdrRules(" QRIS=0.7% ; credit_card = 2.9% + 2000 ")).toBe(
      "qris=0.7%; credit_card=2.9%+2000",
    );
    expect(validateIntegration("MIDTRANS_FEES", "QRIS=0.7%")).toEqual({
      ok: true,
      value: "qris=0.7%",
    });
    expect(validateIntegration("MIDTRANS_FEES", "qris=lots").ok).toBe(false);
  });

  it("computes whole-rupiah fees, falling back to * and never ≥ gross", () => {
    const rules = (() => {
      const r = parseMdrRules("qris=0.7%; credit_card=2.9%+2000; *=4000");
      if (!r.ok) throw new Error(r.error);
      return r.rules;
    })();
    expect(mdrFee(rules, "qris", 150000)).toBe(1050);
    expect(mdrFee(rules, "qris", 10071)).toBe(70); // 70.497 → 70
    expect(mdrFee(rules, "credit_card", 100000)).toBe(4900);
    expect(mdrFee(rules, "bank_transfer", 100000)).toBe(4000);
    expect(mdrFee(rules, null, 100000)).toBe(4000);
    expect(mdrFee(rules, "bank_transfer", 3000)).toBe(0); // fee would eat the payment
    expect(mdrFee(null, "qris", 100000)).toBe(0);
    expect(mdrFee({ qris: { percent: 0.7, flat: 0 } }, "gopay", 100000)).toBe(0);
    expect(mdrFee(rules, "qris", 0)).toBe(0);
  });

  it("refuses prototype keys and never reads inherited properties (review I1)", () => {
    for (const bad of ["__proto__=1%", "constructor=1%", "prototype=1%"])
      expect(mdrRulesProblem(bad), bad).not.toBeNull();
    const r = parseMdrRules("qris=1%");
    if (!r.ok) throw new Error(r.error);
    expect(Object.getPrototypeOf(r.rules)).toBeNull();
    expect(mdrFee(r.rules, "constructor", 100000)).toBe(0);
    expect(mdrFee(r.rules, "toString", 100000)).toBe(0);
    expect(mdrFee(r.rules, "__proto__", 100000)).toBe(0);
  });

  it("uses one idempotency key per gateway row", () => {
    expect(mdrExternalId("abc-123")).toBe("invoice_mdr:abc-123");
    expect(mdrExternalId("a/b c")).toBe("invoice_mdr:abc");
  });
});

describe("partial gateway payments (#124)", () => {
  it("defaults to the whole remaining amount", () => {
    expect(chargeAmount(250000, null, false)).toBe(250000);
    expect(chargeAmount(250000, null, true)).toBe(250000);
    expect(chargeAmount(250000.5, null, true)).toBeNull();
    expect(chargeAmount(0, null, true)).toBeNull();
  });

  it("accepts a partial amount only when enabled and within min..remaining", () => {
    expect(chargeAmount(250000, 100000, false)).toBeNull();
    expect(chargeAmount(250000, 250000, false)).toBe(250000);
    expect(chargeAmount(250000, 100000, true)).toBe(100000);
    expect(chargeAmount(250000, GATEWAY_MIN_PARTIAL, true)).toBe(GATEWAY_MIN_PARTIAL);
    expect(chargeAmount(250000, GATEWAY_MIN_PARTIAL - 1, true)).toBeNull();
    expect(chargeAmount(250000, 250001, true)).toBeNull();
    expect(chargeAmount(250000, 1000.5, true)).toBeNull();
    // Remaining below the minimum: only the exact remaining amount.
    expect(chargeAmount(5000, 5000, true)).toBe(5000);
    expect(chargeAmount(5000, 4000, true)).toBeNull();
  });

  it("refuses partials that would leave less than the minimum unpaid (review I5)", () => {
    const min = GATEWAY_MIN_PARTIAL;
    expect(chargeAmount(250000, 250000 - 1, true)).toBeNull();
    expect(chargeAmount(250000, 250000 - min + 1, true)).toBeNull();
    expect(chargeAmount(250000, 250000 - min, true)).toBe(250000 - min);
    // 15.000 left: any partial would leave < 10.000 or be < 10.000, so only the full amount.
    expect(chargeAmount(15000, 10000, true)).toBeNull();
    expect(chargeAmount(15000, 15000, true)).toBe(15000);
    expect(chargeAmount(2 * min, min, true)).toBe(min);
    expect(partialAllowed(2 * min)).toBe(true);
    expect(partialAllowed(2 * min - 1)).toBe(false);
    expect(partialAllowed(5000)).toBe(false);
  });

  it("refuses a malformed public amount instead of charging in full (review I3)", () => {
    expect(parseRequestedAmount(undefined)).toBeNull();
    expect(parseRequestedAmount(null)).toBeNull();
    expect(parseRequestedAmount(10000)).toBe(10000);
    for (const bad of ["10000", 10000.5, 0, -1, Number.NaN, Infinity, 2 ** 60, {}, true])
      expect(parseRequestedAmount(bad), String(bad)).toBe("invalid");
  });

  it("partial payments move the invoice partial → paid via the existing rules", () => {
    const inv = { status: "unpaid" as InvoiceStatus, total: 250000, paid: 0 };
    expect(paymentProblem(inv, 100000)).toBeNull();
    expect(derivedStatus("unpaid", 250000, 100000)).toBe("partial");
    const after = { status: "partial" as InvoiceStatus, total: 250000, paid: 100000 };
    expect(chargeAmount(150000, 150001, true)).toBeNull();
    expect(paymentProblem(after, 150000)).toBeNull();
    expect(derivedStatus("partial", 250000, 250000)).toBe("paid");
  });

  it("MIDTRANS_PARTIAL is a boolean integration that defaults to false", () => {
    expect(validateIntegration("MIDTRANS_PARTIAL", "TRUE")).toEqual({ ok: true, value: "true" });
    expect(validateIntegration("MIDTRANS_PARTIAL", "maybe").ok).toBe(false);
    expect(resolveIntegration("MIDTRANS_PARTIAL", null, undefined).value).toBe("false");
  });
});

describe("pendingAgedOut (review M1, #124)", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("ages out tokenless rows after a short grace and tokens after expiry + grace", () => {
    expect(pendingAgedOut({ snap_token: null, created_at: at(TOKENLESS_GRACE_MS + 1) }, now)).toBe(
      true,
    );
    expect(pendingAgedOut({ snap_token: null, created_at: at(1000) }, now)).toBe(false);
    expect(pendingAgedOut({ snap_token: "s", expires_at: at(EXPIRY_GRACE_MS + 1) }, now)).toBe(
      true,
    );
    expect(pendingAgedOut({ snap_token: "s", expires_at: at(EXPIRY_GRACE_MS - 1000) }, now)).toBe(
      false,
    );
    const day = ORDER_EXPIRY_MIN * 60_000;
    expect(
      pendingAgedOut(
        { snap_token: "s", expires_at: null, created_at: at(day + EXPIRY_GRACE_MS + 1) },
        now,
      ),
    ).toBe(true);
    expect(pendingAgedOut({ snap_token: "s", expires_at: null, created_at: at(day) }, now)).toBe(
      false,
    );
    expect(pendingAgedOut({ snap_token: "s", expires_at: "garbage" }, now)).toBe(false);
    expect(pendingAgedOut({ snap_token: null, created_at: null }, now)).toBe(false);
  });
});
