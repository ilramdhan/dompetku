/**
 * Pure, client-safe payment-gateway core (v25, issue #97): the provider interface, the internal
 * status set, the status transition machine, order ids, the amount a gateway may charge and the
 * refund pre-checks. Provider specifics (Midtrans) live in ./midtrans.ts (pure) and
 * ./midtrans.server.ts (HTTP). Unit-tested in src/test/gateway.test.ts.
 *
 * Status model (stored in `gateway_transactions.status`)
 * - pending: created / waiting for the customer (also card `challenge`).
 * - success: money received (Midtrans settlement, or capture with fraud accept).
 * - failed: deny / cancel / failure.  expired: payment window elapsed.
 * - partial_refund / refunded: after success, part / all of it went back to the customer.
 *
 * Transition rules (`nextStatus`): late or out-of-order events never downgrade a final state.
 * - pending → anything.
 * - failed / expired → success only (a verified late settlement means money arrived; recording it
 *   is safer than losing it); between each other the first one wins.
 * - success → partial_refund / refunded; deny/cancel/expire/pending after success are ignored.
 * - partial_refund → partial_refund (grows) / refunded.  refunded is terminal.
 */

export const GATEWAY_STATUSES = [
  "pending",
  "success",
  "failed",
  "expired",
  "refunded",
  "partial_refund",
] as const;
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number];
export const GATEWAY_PROVIDERS = ["midtrans"] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

/** Indonesian i18n keys for the admin list. */
export const GATEWAY_STATUS_LABEL: Record<GatewayStatus, string> = {
  pending: "Menunggu pembayaran",
  success: "Berhasil",
  failed: "Gagal",
  expired: "Lewat batas waktu",
  refunded: "Dikembalikan",
  partial_refund: "Dikembalikan sebagian",
};

/** States that mean money was received at some point (the payment must be booked). */
export const PAID_STATES: readonly GatewayStatus[] = ["success", "partial_refund", "refunded"];
/** States a row can be deleted in (with its invoice): nothing was ever received. */
export const DEAD_STATES: readonly GatewayStatus[] = ["failed", "expired"];

export function isGatewayStatus(s: unknown): s is GatewayStatus {
  return typeof s === "string" && (GATEWAY_STATUSES as readonly string[]).includes(s);
}

/** Status after `incoming` is observed on a row currently in `current` (see header). */
export function nextStatus(current: GatewayStatus, incoming: GatewayStatus): GatewayStatus {
  if (current === incoming) return current;
  switch (current) {
    case "pending":
      return incoming;
    case "failed":
    case "expired":
      return incoming === "success" ? "success" : current;
    case "success":
      return incoming === "partial_refund" || incoming === "refunded" ? incoming : current;
    case "partial_refund":
      return incoming === "refunded" ? "refunded" : current;
    case "refunded":
      return current;
  }
}

/** True when `incoming` changes nothing (late/duplicate event). */
export function isIgnoredEvent(current: GatewayStatus, incoming: GatewayStatus): boolean {
  return nextStatus(current, incoming) === current && incoming !== current;
}

/* ---------------- provider interface ---------------- */

export type GatewayConfig = {
  provider: GatewayProvider;
  serverKey: string;
  clientKey: string | null;
  production: boolean;
  /** Core API base (status/refund), e.g. https://api.sandbox.midtrans.com */
  apiBase: string;
  /** Snap base (create), e.g. https://app.sandbox.midtrans.com */
  snapBase: string;
  /** True when a test-only base URL override is active (the browser then uses redirect_url). */
  overridden: boolean;
};

export type CreatePaymentInput = {
  orderId: string;
  amount: number;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Where Snap sends the customer back (optional). */
  finishUrl: string | null;
  expiryMinutes: number;
};
export type CreatePaymentResult = { token: string; redirectUrl: string };

export type RefundEntry = { key: string; amount: number; at: string | null };

/** Provider-neutral status of one order, as verified with the provider API. */
export type GatewayState = {
  orderId: string;
  gatewayTxId: string | null;
  status: GatewayStatus;
  /** Raw provider status (e.g. settlement, capture) for refund pre-checks. */
  providerStatus: string;
  grossAmount: number;
  paymentType: string | null;
  refundedAmount: number;
  refunds: RefundEntry[];
  /** Whitelisted fields worth keeping in `raw` (never keys/signatures). */
  raw: Record<string, string | number | null>;
};

export type WebhookCheck =
  { ok: true; orderId: string } | { ok: false; status: 400 | 401; error: string };

export interface PaymentGateway {
  createPayment(c: GatewayConfig, input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhook(c: GatewayConfig, body: unknown): WebhookCheck;
  /** null = the provider does not know this order (yet). */
  fetchStatus(c: GatewayConfig, orderId: string): Promise<GatewayState | null>;
  refund(
    c: GatewayConfig,
    orderId: string,
    r: { key: string; amount: number; reason: string },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

/* ---------------- order ids & amounts ---------------- */

const ORDER_RE = /^[A-Za-z0-9._~-]{1,50}$/;

/** Midtrans-safe order id: `<invoice number>-<random>` (letters, digits, dash; ≤ 50 chars). */
export function makeOrderId(invoiceNumber: string, random: string): string {
  const num =
    String(invoiceNumber ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "INV";
  const rand = String(random ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return `${num}-${rand || "0"}`;
}

export function isOrderId(s: unknown): s is string {
  return typeof s === "string" && ORDER_RE.test(s);
}

/**
 * Amount the gateway may charge for an invoice: the whole remaining amount, in whole rupiah.
 * null when nothing is due or the remaining amount has cents (IDR gateways take integers only;
 * the customer then pays by transfer instead).
 */
export function gatewayAmount(remaining: number | string): number | null {
  const r = Math.round((Number(remaining) || 0) * 100) / 100;
  if (!(r >= 1) || !Number.isInteger(r) || r > 1e12) return null;
  return r;
}

export const amountsMatch = (a: number | string, b: number | string) =>
  Math.abs(Number(a) - Number(b)) < 0.005;

/** A stored pending row can be handed out again (same amount, still ≥ 10 min to live). */
export function reusablePending(
  row: {
    status: string;
    gross_amount: number | string;
    snap_token: string | null;
    redirect_url: string | null;
    expires_at: string | null;
  },
  amount: number,
  now: Date,
): boolean {
  if (row.status !== "pending" || !row.snap_token || !row.redirect_url || !row.expires_at)
    return false;
  if (!amountsMatch(row.gross_amount, amount)) return false;
  const exp = Date.parse(row.expires_at);
  return Number.isFinite(exp) && exp - now.getTime() > 10 * 60_000;
}

/** Public "Bayar sekarang" switch. */
export function gatewayAvailable(o: {
  ready: boolean;
  configured: boolean;
  demo: boolean;
  status: string;
  remaining: number;
}): boolean {
  return (
    o.ready &&
    o.configured &&
    !o.demo &&
    (o.status === "unpaid" || o.status === "partial") &&
    gatewayAmount(o.remaining) !== null
  );
}

/* ---------------- refunds ---------------- */

/** Payment types Midtrans can refund through the API (bank transfer / VA / stores cannot). */
export const REFUNDABLE_TYPES = [
  "credit_card",
  "gopay",
  "shopeepay",
  "qris",
  "dana",
  "ovo",
  "kredivo",
  "akulaku",
] as const;
/** Refundable, but full refunds only. */
export const FULL_REFUND_ONLY_TYPES = ["shopeepay", "ovo"] as const;

export function refundableLeft(row: {
  gross_amount: number | string;
  refunded_amount: number | string;
}): number {
  return Math.max(
    0,
    Math.round((Number(row.gross_amount) - Number(row.refunded_amount || 0)) * 100) / 100,
  );
}

/** Indonesian i18n error key, or null when a refund of `amount` may be sent. */
export function refundProblem(
  row: {
    status: string;
    gross_amount: number | string;
    refunded_amount: number | string;
    payment_type: string | null;
    provider_status?: string | null;
  },
  amount: number,
): string | null {
  if (row.status !== "success" && row.status !== "partial_refund")
    return "Hanya pembayaran berhasil yang bisa dikembalikan";
  if (row.provider_status && row.provider_status !== "settlement")
    return "Pembayaran belum settlement; coba lagi nanti";
  const type = row.payment_type ?? "";
  if (!(REFUNDABLE_TYPES as readonly string[]).includes(type))
    return "Metode ini tidak bisa direfund lewat Midtrans (mis. transfer bank/VA); kembalikan dana secara manual";
  if (!Number.isFinite(amount) || amount <= 0) return "Jumlah harus lebih dari 0";
  if (!Number.isInteger(amount)) return "Jumlah refund harus bilangan bulat";
  const left = refundableLeft(row);
  if (amount > left + 0.005) return "Jumlah melebihi sisa yang bisa dikembalikan";
  if (
    (FULL_REFUND_ONLY_TYPES as readonly string[]).includes(type) &&
    (row.status !== "success" || !amountsMatch(amount, left))
  )
    return "Metode ini hanya mendukung refund penuh";
  return null;
}

/** Deterministic refund key per row and sequence: a double click re-sends the same key. */
export function refundKey(rowId: string, seq: number): string {
  const id = String(rowId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);
  return `rf-${id}-${Math.max(1, Math.floor(seq))}`;
}

/** Idempotency key of the reversing expense of one refund. */
export function refundExternalId(rowId: string, key: string): string {
  return `invoice_refund:${rowId}:${String(key)
    .replace(/[^A-Za-z0-9._~-]/g, "")
    .slice(0, 80)}`;
}

/** Refunds not yet booked (by key), in order. */
export function newRefunds(
  refunds: readonly RefundEntry[],
  bookedKeys: ReadonlySet<string>,
): RefundEntry[] {
  return refunds.filter((r) => r.amount > 0 && !bookedKeys.has(r.key));
}

/** Payment refunded total, never above the payment amount. */
export function cappedRefund(paymentAmount: number | string, refunded: number): number {
  return Math.max(0, Math.min(Number(paymentAmount) || 0, Math.round(refunded * 100) / 100));
}
