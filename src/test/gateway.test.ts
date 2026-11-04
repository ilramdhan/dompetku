import { describe, expect, it } from "vitest";
import {
  GATEWAY_STATUSES,
  gatewayAmount,
  gatewayAvailable,
  isIgnoredEvent,
  isOrderId,
  makeOrderId,
  newRefunds,
  nextStatus,
  refundExternalId,
  refundKey,
  refundProblem,
  reusablePending,
  cappedRefund,
  duplicateRefundOk,
  nextRefundSeq,
  type GatewayStatus,
} from "@/lib/gateway/types";
import { netPaymentAmount, periodSummary } from "@/lib/invoice-report";
import { toPublicInvoice } from "@/lib/invoice-share";
import {
  MIDTRANS_HOSTS,
  baseOverride,
  basicAuth,
  isSandboxKey,
  keyModeMismatch,
  mapMidtransStatus,
  midtransError,
  parseBool,
  parseNotification,
  parseStatusResponse,
  signatureInput,
  snapJsUrl,
  snapRequestBody,
} from "@/lib/gateway/midtrans";
import { paidSum, derivedStatus } from "@/lib/invoices";

// Dummy sandbox key, assembled at runtime so secret scanners don't flag a literal.
const KEY = ["SB", "Mid", "server", "TEST_ONLY_not_a_real_key"].join("-");

describe("midtrans signature", () => {
  it("hashes order_id + status_code + gross_amount + server key as raw strings", () => {
    expect(signatureInput("INV-1-abc", "200", "150000.00", KEY)).toBe(
      `INV-1-abc200150000.00${KEY}`,
    );
  });

  it("parses only well-formed notifications", () => {
    const ok = {
      order_id: "INV-1-abc",
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: "A".repeat(128),
      transaction_status: "settlement",
    };
    expect(parseNotification(ok)).toMatchObject({
      order_id: "INV-1-abc",
      signature_key: "a".repeat(128),
    });
    expect(parseNotification({ ...ok, order_id: "bad id with spaces" })).toBeNull();
    expect(parseNotification({ ...ok, signature_key: "xyz" })).toBeNull();
    expect(parseNotification({ ...ok, gross_amount: "1e5" })).toBeNull();
    expect(parseNotification({ ...ok, status_code: 200 })).not.toBeNull();
    expect(parseNotification(null)).toBeNull();
    expect(parseNotification([ok])).toBeNull();
    expect(parseNotification("x")).toBeNull();
  });
});

describe("midtrans status mapping", () => {
  it("maps transaction_status + fraud_status", () => {
    expect(mapMidtransStatus("settlement", null)).toBe("success");
    expect(mapMidtransStatus("settlement", "accept")).toBe("success");
    expect(mapMidtransStatus("capture", "accept")).toBe("success");
    expect(mapMidtransStatus("capture", undefined)).toBe("success");
    expect(mapMidtransStatus("capture", "challenge")).toBe("pending");
    expect(mapMidtransStatus("capture", "deny")).toBe("failed");
    expect(mapMidtransStatus("pending", null)).toBe("pending");
    expect(mapMidtransStatus("authorize", null)).toBe("pending");
    for (const s of ["deny", "cancel", "failure"])
      expect(mapMidtransStatus(s, null)).toBe("failed");
    expect(mapMidtransStatus("expire", null)).toBe("expired");
    expect(mapMidtransStatus("refund", null)).toBe("refunded");
    expect(mapMidtransStatus("partial_refund", null)).toBe("partial_refund");
    expect(mapMidtransStatus("chargeback", null)).toBe("refunded");
    expect(mapMidtransStatus("SETTLEMENT", "ACCEPT")).toBe("success");
    expect(mapMidtransStatus("weird", null)).toBeNull();
    expect(mapMidtransStatus(undefined, undefined)).toBeNull();
  });
});

describe("status transition machine", () => {
  const all = GATEWAY_STATUSES;
  it("pending accepts anything", () => {
    for (const s of all) expect(nextStatus("pending", s)).toBe(s);
  });
  it("late expire/cancel/deny never downgrade success", () => {
    for (const s of ["pending", "failed", "expired"] as GatewayStatus[]) {
      expect(nextStatus("success", s)).toBe("success");
      expect(isIgnoredEvent("success", s)).toBe(true);
    }
  });
  it("refunds only from success, growing to full", () => {
    expect(nextStatus("success", "partial_refund")).toBe("partial_refund");
    expect(nextStatus("success", "refunded")).toBe("refunded");
    expect(nextStatus("partial_refund", "refunded")).toBe("refunded");
    expect(nextStatus("partial_refund", "success")).toBe("partial_refund");
    expect(nextStatus("pending", "refunded")).toBe("refunded"); // verified state wins over a missed settlement
    expect(nextStatus("failed", "refunded")).toBe("failed");
    expect(nextStatus("expired", "partial_refund")).toBe("expired");
  });
  it("refunded is terminal", () => {
    for (const s of all) expect(nextStatus("refunded", s)).toBe("refunded");
  });
  it("failed/expired only move to a verified success", () => {
    expect(nextStatus("expired", "success")).toBe("success");
    expect(nextStatus("failed", "success")).toBe("success");
    expect(nextStatus("failed", "expired")).toBe("failed");
    expect(nextStatus("expired", "failed")).toBe("expired");
    expect(nextStatus("expired", "pending")).toBe("expired");
  });
  it("is idempotent", () => {
    for (const a of all)
      for (const b of all) expect(nextStatus(nextStatus(a, b), b)).toBe(nextStatus(a, b));
  });
});

describe("order ids and amounts", () => {
  it("builds Midtrans-safe order ids", () => {
    const id = makeOrderId("INV-202610-0007", "a1b2c3d4e5f6");
    expect(id).toBe("INV-202610-0007-a1b2c3d4e5f6");
    expect(isOrderId(id)).toBe(true);
    const weird = makeOrderId("inv/2026 10#7 ".repeat(10), "ZZ!!");
    expect(isOrderId(weird)).toBe(true);
    expect(weird.length).toBeLessThanOrEqual(50);
    expect(makeOrderId("", "")).toBe("INV-0");
    expect(isOrderId("a b")).toBe(false);
    expect(isOrderId("x".repeat(51))).toBe(false);
  });
  it("charges the whole remaining amount in rupiah only", () => {
    expect(gatewayAmount(150000)).toBe(150000);
    expect(gatewayAmount("150000.00")).toBe(150000);
    expect(gatewayAmount(150000.5)).toBeNull();
    expect(gatewayAmount(0)).toBeNull();
    expect(gatewayAmount(-5)).toBeNull();
    expect(gatewayAmount("x")).toBeNull();
  });
  it("reuses a live pending order of the same amount", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const row = {
      status: "pending",
      gross_amount: "150000.00",
      snap_token: "tok",
      redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/tok",
      expires_at: "2026-10-30T12:00:00Z",
    };
    expect(reusablePending(row, 150000, now)).toBe(true);
    expect(reusablePending(row, 100000, now)).toBe(false);
    expect(reusablePending({ ...row, status: "failed" }, 150000, now)).toBe(false);
    expect(reusablePending({ ...row, snap_token: null }, 150000, now)).toBe(false);
    expect(reusablePending({ ...row, expires_at: "2026-10-30T00:05:00Z" }, 150000, now)).toBe(
      false,
    );
  });
  it("shows Bayar sekarang only when everything is in place", () => {
    const base = { ready: true, configured: true, demo: false, status: "unpaid", remaining: 1000 };
    expect(gatewayAvailable(base)).toBe(true);
    expect(gatewayAvailable({ ...base, status: "partial" })).toBe(true);
    expect(gatewayAvailable({ ...base, ready: false })).toBe(false);
    expect(gatewayAvailable({ ...base, configured: false })).toBe(false);
    expect(gatewayAvailable({ ...base, demo: true })).toBe(false);
    expect(gatewayAvailable({ ...base, status: "paid" })).toBe(false);
    expect(gatewayAvailable({ ...base, status: "draft" })).toBe(false);
    expect(gatewayAvailable({ ...base, remaining: 0 })).toBe(false);
  });
});

describe("refund rules", () => {
  const row = {
    status: "success",
    gross_amount: 100000,
    refunded_amount: 0,
    payment_type: "qris",
    provider_status: "settlement",
  };
  it("allows full and partial refunds of refundable methods", () => {
    expect(refundProblem(row, 100000)).toBeNull();
    expect(refundProblem(row, 40000)).toBeNull();
    expect(
      refundProblem({ ...row, status: "partial_refund", refunded_amount: 40000 }, 60000),
    ).toBeNull();
    // A second partial refund: Midtrans now reports transaction_status "partial_refund".
    expect(
      refundProblem(
        {
          ...row,
          status: "partial_refund",
          refunded_amount: 40000,
          provider_status: "partial_refund",
        },
        60000,
      ),
    ).toBeNull();
  });
  it("refuses everything else", () => {
    expect(refundProblem({ ...row, status: "pending" }, 1000)).toMatch(/berhasil/);
    expect(refundProblem({ ...row, status: "refunded" }, 1000)).toMatch(/berhasil/);
    expect(refundProblem({ ...row, provider_status: "capture" }, 1000)).toMatch(/settlement/);
    expect(refundProblem({ ...row, payment_type: "bank_transfer" }, 1000)).toMatch(/manual/);
    expect(refundProblem({ ...row, payment_type: "echannel" }, 1000)).toMatch(/manual/);
    expect(refundProblem(row, 0)).toMatch(/lebih dari 0/);
    expect(refundProblem(row, 10.5)).toMatch(/bulat/);
    expect(refundProblem(row, 100001)).toMatch(/melebihi/);
    expect(refundProblem({ ...row, payment_type: "shopeepay" }, 50000)).toMatch(/penuh/);
    expect(refundProblem({ ...row, payment_type: "shopeepay" }, 100000)).toBeNull();
  });
  it("uses deterministic keys and external ids", () => {
    const id = "6b1e8f2a-0000-4000-8000-000000000001";
    expect(refundKey(id, 1)).toBe("rf-6b1e8f2a0000-1");
    expect(refundKey(id, 1)).toBe(refundKey(id, 1));
    expect(refundKey(id, 0)).toBe("rf-6b1e8f2a0000-1");
    expect(refundExternalId(id, "rf-x-1")).toBe(`invoice_refund:${id}:rf-x-1`);
    expect(refundExternalId(id, "a b/c")).toBe(`invoice_refund:${id}:abc`);
    expect(
      newRefunds(
        [
          { key: "a", amount: 1, at: null },
          { key: "b", amount: 2, at: null },
        ],
        new Set(["a"]),
      ),
    ).toEqual([{ key: "b", amount: 2, at: null }]);
    expect(cappedRefund(100, 150)).toBe(100);
    expect(cappedRefund("100", 40)).toBe(40);
  });
  it("net paid subtracts refunds so the invoice status follows", () => {
    const pays = [{ amount: 100000, refunded: 40000 }, { amount: "50000" }];
    expect(paidSum(pays)).toBe(110000);
    expect(derivedStatus("paid", 150000, paidSum(pays))).toBe("partial");
    expect(derivedStatus("paid", 100000, paidSum([{ amount: 100000, refunded: 100000 }]))).toBe(
      "unpaid",
    );
  });
});

describe("midtrans request/response helpers", () => {
  it("uses the official hosts and fixed snap.js", () => {
    expect(MIDTRANS_HOSTS.sandbox.api).toBe("https://api.sandbox.midtrans.com");
    expect(MIDTRANS_HOSTS.production.snap).toBe("https://app.midtrans.com");
    expect(snapJsUrl(false)).toBe("https://app.sandbox.midtrans.com/snap/snap.js");
    expect(snapJsUrl(true)).toBe("https://app.midtrans.com/snap/snap.js");
  });
  it("only honours a clean base override in sandbox", () => {
    expect(baseOverride("http://127.0.0.1:9999/", false)).toBe("http://127.0.0.1:9999");
    expect(baseOverride("http://127.0.0.1:9999", true)).toBeNull();
    expect(baseOverride("ftp://x", false)).toBeNull();
    expect(baseOverride("http://u:p@x", false)).toBeNull();
    expect(baseOverride("http://x/?a=1", false)).toBeNull();
    expect(baseOverride("", false)).toBeNull();
    expect(baseOverride("not a url", false)).toBeNull();
  });
  it("builds Basic auth from server key + colon", () => {
    expect(basicAuth("abc")).toBe(`Basic ${Buffer.from("abc:").toString("base64")}`);
  });
  it("parses booleans and detects key/mode mismatch", () => {
    expect(parseBool("TRUE", false)).toBe(true);
    expect(parseBool("off", true)).toBe(false);
    expect(parseBool(undefined, true)).toBe(true);
    expect(keyModeMismatch("SB-Mid-server-x", true)).toBe(true);
    expect(keyModeMismatch("SB-Mid-server-x", false)).toBe(false);
    expect(keyModeMismatch("Mid-server-x", true)).toBe(false);
  });
  it("builds the Snap body from server values only", () => {
    const b = snapRequestBody({
      orderId: "INV-1-abc",
      amount: 150000,
      invoiceNumber: "INV-1",
      customerName: "<b>Budi</b>",
      customerEmail: "budi@example.com",
      customerPhone: "+62 812-0000-0000",
      finishUrl: "https://dompet.example.com/i/tok?gw=1",
      expiryMinutes: 1440,
    });
    expect(b.transaction_details).toEqual({ order_id: "INV-1-abc", gross_amount: 150000 });
    expect(b.item_details[0]).toMatchObject({ price: 150000, quantity: 1 });
    expect(b.customer_details.first_name).not.toContain("<");
    expect(b.customer_details).toMatchObject({
      email: "budi@example.com",
      phone: "+6281200000000",
    });
    expect(b.callbacks).toEqual({ finish: "https://dompet.example.com/i/tok?gw=1" });
    expect(b.expiry).toEqual({ unit: "minutes", duration: 1440 });
    const bare = snapRequestBody({
      orderId: "o",
      amount: 1,
      invoiceNumber: "",
      customerName: "",
      customerEmail: null,
      customerPhone: null,
      finishUrl: null,
      expiryMinutes: 1,
    });
    expect(bare).not.toHaveProperty("callbacks");
    expect(bare.customer_details).toEqual({ first_name: "Customer" });
    expect(bare.expiry.duration).toBe(15);
  });
  it("parses Get Status responses with refunds", () => {
    const s = parseStatusResponse({
      status_code: "200",
      transaction_id: "tx-1",
      order_id: "INV-1-abc",
      gross_amount: "150000.00",
      payment_type: "qris",
      transaction_status: "partial_refund",
      fraud_status: "accept",
      refund_amount: "50000.00",
      signature_key: "secret-ish",
      refunds: [
        { refund_key: "rf-1", refund_amount: "50000.00", created_at: "2026-10-30 10:00:00" },
        { refund_amount: "0" },
      ],
    });
    expect(s).toMatchObject({
      orderId: "INV-1-abc",
      gatewayTxId: "tx-1",
      status: "partial_refund",
      providerStatus: "partial_refund",
      grossAmount: 150000,
      paymentType: "qris",
      refundedAmount: 50000,
      refunds: [{ key: "rf-1", amount: 50000, at: "2026-10-30 10:00:00" }],
    });
    expect(JSON.stringify(s?.raw)).not.toContain("secret-ish");
    expect(
      parseStatusResponse({ status_code: "404", status_message: "Transaction doesn't exist." }),
    ).toBeNull();
    expect(parseStatusResponse({ order_id: "x", transaction_status: "?" })).toBeNull();
    expect(parseStatusResponse(null)).toBeNull();
  });
  it("formats errors without echoing request data", () => {
    expect(
      midtransError({ error_messages: ["transaction_details.gross_amount is required"] }, 400),
    ).toBe("Midtrans 400: transaction_details.gross_amount is required");
    expect(midtransError("x", 502)).toBe("Midtrans HTTP 502");
  });
});

describe("refund keys after a lagging status (review #97)", () => {
  const id = "6b1e8f2a-0000-4000-8000-000000000001";
  const k = (n: number) => refundKey(id, n);
  it("never reuses a key that Midtrans or the local ledger already used", () => {
    expect(nextRefundSeq(id, [], [])).toBe(1);
    // Midtrans lags (lists nothing) but the first refund is booked locally.
    expect(nextRefundSeq(id, [], [refundExternalId(id, k(1))])).toBe(2);
    expect(nextRefundSeq(id, [k(1)], [refundExternalId(id, k(1))])).toBe(2);
    expect(nextRefundSeq(id, [k(1), k(2)], [refundExternalId(id, k(1))])).toBe(3);
    // Dashboard refunds use foreign keys: still counted.
    expect(nextRefundSeq(id, ["dash-abc", "dash-def"], [])).toBe(3);
    expect(nextRefundSeq(id, [k(5)], [])).toBe(6);
  });
  it("accepts a 406 duplicate only with the same key and amount", () => {
    const listed = [{ key: k(1), amount: 40000, at: null }];
    expect(duplicateRefundOk(listed, k(1), 40000)).toBe(true);
    expect(duplicateRefundOk(listed, k(1), 60000)).toBe(false);
    expect(duplicateRefundOk(listed, k(2), 40000)).toBe(false);
    expect(duplicateRefundOk([], k(1), 40000)).toBe(false);
    expect(duplicateRefundOk(null, k(1), 40000)).toBe(false);
  });
});

describe("refunds in reports and the public view (review #97)", () => {
  it("nets refunded amounts out of payments", () => {
    expect(netPaymentAmount({ amount: 100000, refunded: 40000 })).toBe(60000);
    expect(netPaymentAmount({ amount: "100000" })).toBe(100000);
    expect(netPaymentAmount({ amount: 100, refunded: 500 })).toBe(0);
    const s = periodSummary(
      [
        {
          id: "i1",
          status: "partial",
          total: 100000,
          issue_date: "2026-10-01",
          account_id: null,
        },
      ],
      [{ invoice_id: "i1", amount: 100000, refunded: 40000, paid_at: "2026-10-05" }],
      "2026-10",
    );
    expect(s.received).toBe(60000);
  });
  it("public page lists net payments and hides fully refunded ones", () => {
    const pub = toPublicInvoice(
      {
        number: "INV-1",
        issue_date: "2026-10-01",
        customer_name: "Budi",
        status: "partial",
        total: 100000,
        paid: 60000,
      },
      [],
      [
        { paid_at: "2026-10-05", amount: 100000, refunded: 40000 },
        { paid_at: "2026-10-06", amount: 5000, refunded: 5000 },
      ],
      "2026-10-10",
    );
    expect(pub?.payments).toEqual([{ paid_at: "2026-10-05", amount: 60000 }]);
  });
});

describe("key/mode guard (review #97)", () => {
  it("detects sandbox keys", () => {
    expect(isSandboxKey("SB-Mid-server-x")).toBe(true);
    expect(isSandboxKey("Mid-server-x")).toBe(false);
    expect(isSandboxKey(null)).toBe(false);
  });
});
