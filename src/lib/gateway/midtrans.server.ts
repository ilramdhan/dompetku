/**
 * Midtrans I/O (v25, issue #97): Snap create, Core API status/refund over fetch with Basic auth
 * (server key + ":") and a timeout, plus the SHA-512 webhook signature check (timingSafeEqual).
 * Pure parts (bodies, mapping, parsing) live in ./midtrans.ts. Server-only.
 */
import { createHash, timingSafeEqual } from "crypto";
import {
  MIDTRANS_HOSTS,
  baseOverride,
  basicAuth,
  isSandboxKey,
  keyModeMismatch,
  midtransError,
  parseBool,
  parseNotification,
  parseStatusResponse,
  signatureInput,
  snapRequestBody,
} from "./midtrans";
import type { GatewayConfig, PaymentGateway, WebhookCheck } from "./types";

const TIMEOUT_MS = 10_000;

/**
 * Effective Midtrans config, or null when the gateway is off (toggle off / no server key).
 * Credentials come only from `getIntegrations` (DB > env > default). The base URL overrides
 * (MIDTRANS_API_BASE / MIDTRANS_SNAP_BASE) are env-only, for local E2E against a mock server, and
 * are ignored in production mode.
 */
export async function midtransConfig(): Promise<GatewayConfig | null> {
  const { getIntegrations } = await import("../integrations.server");
  const v = await getIntegrations([
    "MIDTRANS_ENABLED",
    "MIDTRANS_SERVER_KEY",
    "MIDTRANS_CLIENT_KEY",
    "MIDTRANS_PRODUCTION",
  ]);
  if (!parseBool(v.MIDTRANS_ENABLED, false)) return null;
  const serverKey = v.MIDTRANS_SERVER_KEY?.trim();
  if (!serverKey) return null;
  const production = parseBool(v.MIDTRANS_PRODUCTION, false);
  // A sandbox key (SB-…) in production mode or a production key in sandbox mode would fail every
  // call (and could hit the wrong environment): treat the gateway as off.
  if (keyModeMismatch(serverKey, production)) return null;
  const hosts = production ? MIDTRANS_HOSTS.production : MIDTRANS_HOSTS.sandbox;
  // Test-only overrides: sandbox mode AND a sandbox key, never with a production key.
  const testable = !production && isSandboxKey(serverKey);
  const api = testable ? baseOverride(process.env["MIDTRANS_API_BASE"], production) : null;
  const snap = testable ? baseOverride(process.env["MIDTRANS_SNAP_BASE"], production) : null;
  return {
    provider: "midtrans",
    serverKey,
    clientKey: v.MIDTRANS_CLIENT_KEY?.trim() || null,
    production,
    apiBase: api ?? hosts.api,
    snapBase: snap ?? hosts.snap,
    overridden: !!(api || snap),
  };
}

async function call(
  c: GatewayConfig,
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: init.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuth(c.serverKey),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** SHA-512 hex of the signature input, compared in constant time. */
export function signatureMatches(
  n: { order_id: string; status_code: string; gross_amount: string; signature_key: string },
  serverKey: string,
): boolean {
  const expected = createHash("sha512")
    .update(signatureInput(n.order_id, n.status_code, n.gross_amount, serverKey), "utf8")
    .digest();
  const given = Buffer.from(n.signature_key, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const enc = encodeURIComponent;

export const midtrans: PaymentGateway = {
  async createPayment(c, input) {
    const r = await call(c, `${c.snapBase}/snap/v1/transactions`, {
      method: "POST",
      body: snapRequestBody(input),
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const token = typeof b["token"] === "string" ? b["token"] : null;
    const redirectUrl = typeof b["redirect_url"] === "string" ? b["redirect_url"] : null;
    if (r.status >= 300 || !token || !redirectUrl) throw new Error(midtransError(r.body, r.status));
    return { token: token.slice(0, 200), redirectUrl: redirectUrl.slice(0, 500) };
  },

  verifyWebhook(c, body): WebhookCheck {
    const n = parseNotification(body);
    if (!n) return { ok: false, status: 400, error: "bad request" };
    if (!signatureMatches(n, c.serverKey)) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, orderId: n.order_id };
  },

  async fetchStatus(c, orderId) {
    const r = await call(c, `${c.apiBase}/v2/${enc(orderId)}/status`, { method: "GET" });
    if (r.status === 404) return null;
    if (r.status >= 300 && r.status !== 404) throw new Error(midtransError(r.body, r.status));
    const state = parseStatusResponse(r.body);
    if (state && state.orderId !== orderId) throw new Error("Midtrans: order id mismatch");
    return state;
  },

  async refund(c, orderId, x) {
    const r = await call(c, `${c.apiBase}/v2/${enc(orderId)}/refund`, {
      method: "POST",
      body: { refund_key: x.key, amount: Math.round(x.amount), reason: x.reason.slice(0, 255) },
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    // Midtrans answers HTTP 200 with the outcome in `status_code`; 406 = this refund_key already
    // exists. The caller only accepts that after the re-read status lists the key with the same
    // amount (duplicateRefundOk).
    const code = String(b["status_code"] ?? r.status);
    if (r.status < 300 && code === "200") return { ok: true, duplicate: false };
    if (r.status < 300 && code === "406") return { ok: true, duplicate: true };
    return { ok: false, error: midtransError(r.body, Number(code) || r.status) };
  },

  async expire(c, orderId) {
    // POST /v2/{order_id}/expire (Core API): body status_code 407 = expired. 404 = the customer
    // never picked a payment method, so nothing can be paid at Midtrans anyway.
    try {
      const r = await call(c, `${c.apiBase}/v2/${enc(orderId)}/expire`, { method: "POST" });
      const code = String(((r.body ?? {}) as Record<string, unknown>)["status_code"] ?? r.status);
      return r.status < 300 && (code === "407" || code === "200" || code === "404");
    } catch {
      return false;
    }
  },
};
