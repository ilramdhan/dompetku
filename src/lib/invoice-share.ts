/**
 * Pure, client-safe helpers for public invoice links (v23, issue #93). Unit-tested in
 * src/test/invoice-share.test.ts.
 *
 * - A link is `/i/<token>`: 32 random bytes as base64url (43 chars, 256 bit). Only the SHA-256 hash
 *   of the token is stored (`invoice_shares.token_hash`, server-side in invoice-share.server.ts), so
 *   the raw link is shown to the admin once, right after it is created or rotated.
 * - A link resolves only while it is not revoked, not expired, and the invoice is issued
 *   (unpaid/partial/paid). Every other case is the same "not found" for the visitor.
 * - `toPublicInvoice()` is the ONLY shape that leaves the server for a visitor: a whitelist of
 *   customer-facing fields. Wallet, notes, ids, payment method/reference never appear.
 */
import {
  displayStatus,
  lineTotal,
  remainingOf,
  type DisplayStatus,
  type InvoiceStatus,
} from "./invoices";
import type { PublicPayment } from "./invoice-payments";

/** Random bytes per token (256 bit, well above the 128-bit minimum). */
export const SHARE_TOKEN_BYTES = 32;
/** base64url without padding of SHARE_TOKEN_BYTES bytes. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Expiry choices in the admin UI, in days (0 = no expiry). */
export const SHARE_EXPIRY_DAYS = [0, 7, 30, 90] as const;
/** Max link lifetime on a public demo instance (DEMO_MODE=true). */
export const DEMO_SHARE_MAX_DAYS = 1;
/** Public path prefix of invoice links. */
export const SHARE_PATH = "/i/";

/** Statuses a customer may see; draft and cancelled invoices are never public. */
export function isPublicStatus(status: InvoiceStatus | string): boolean {
  return status === "unpaid" || status === "partial" || status === "paid";
}

/** The token from a URL segment (trimmed), or null when it does not have the token format. */
export function normalizeShareToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return SHARE_TOKEN_RE.test(s) ? s : null;
}

/** base64url (no padding) of raw bytes; works in browsers, workers and Node. */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Expiry timestamp (ISO) for a link made at `now`: `days` ≤ 0 or null = never, except on a demo
 * instance where every link lives at most DEMO_SHARE_MAX_DAYS.
 */
export function shareExpiresAt(
  days: number | null | undefined,
  now: Date,
  demo = false,
): string | null {
  let d = Number(days) > 0 ? Math.min(Math.floor(Number(days)), 3650) : 0;
  if (demo) d = d > 0 ? Math.min(d, DEMO_SHARE_MAX_DAYS) : DEMO_SHARE_MAX_DAYS;
  return d > 0 ? new Date(now.getTime() + d * 86_400_000).toISOString() : null;
}

export type ShareRow = {
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};
export type ShareState = "none" | "active" | "expired" | "revoked";

export function shareState(row: ShareRow | null | undefined, now: Date): ShareState {
  if (!row) return "none";
  if (row.revoked_at) return "revoked";
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return "expired";
  return "active";
}

/** Absolute link: PUBLIC_SITE_URL when set, else the current origin (client-side). */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${SHARE_PATH}${token}`;
}

/**
 * Indonesian phone number → wa.me digits (62…): drops spaces/dashes/brackets and a leading "+",
 * turns a leading 0 (or a bare 8…) into 62. Other country codes are kept as written.
 * Returns null when the result is not 8–15 digits.
 */
export function normalizeWaPhone(phone: string | null | undefined): string | null {
  let s = String(phone ?? "").trim();
  if (!s) return null;
  s = s.replace(/[\s().-]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (s.startsWith("0")) s = `62${s.slice(1)}`;
  else if (s.startsWith("8")) s = `62${s}`;
  return s.length >= 8 && s.length <= 15 ? s : null;
}

/** `https://wa.me/<phone>?text=…` (or `https://wa.me/?text=…` to pick a chat). No WhatsApp API. */
export function waShareUrl(text: string, phone?: string | null): string {
  const p = normalizeWaPhone(phone);
  return `https://wa.me/${p ?? ""}?text=${encodeURIComponent(text)}`;
}

/* ---------------- public payload ---------------- */

export type PublicInvoiceItem = {
  description: string;
  qty: number;
  unit_price: number;
  amount: number;
};
export type PublicInvoicePayment = { paid_at: string; amount: number };
export type PublicInvoice = {
  number: string;
  issue_date: string;
  due_date: string | null;
  customer_name: string;
  currency: string;
  status: DisplayStatus;
  items: PublicInvoiceItem[];
  total: number;
  paid: number;
  remaining: number;
  payments: PublicInvoicePayment[];
};

/** Public page payload: the invoice whitelist plus the v24 payment block (also a whitelist). */
export type PublicInvoiceView = PublicInvoice & { payment: PublicPayment };

/** Every key a visitor can receive (tests assert nothing else leaks). */
export const PUBLIC_INVOICE_KEYS = [
  "number",
  "issue_date",
  "due_date",
  "customer_name",
  "currency",
  "status",
  "items",
  "total",
  "paid",
  "remaining",
  "payments",
] as const;
export const PUBLIC_ITEM_KEYS = ["description", "qty", "unit_price", "amount"] as const;
export const PUBLIC_PAYMENT_KEYS = ["paid_at", "amount"] as const;

type InvoiceLike = {
  number: string;
  issue_date: string;
  due_date?: string | null;
  customer_name: string;
  currency?: string | null;
  status: InvoiceStatus;
  total: number | string;
  paid: number | string;
};

const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

/**
 * Whitelists the customer-facing fields of an invoice (built field by field, never spread), or
 * null when the status is not public. `today` (YYYY-MM-DD, app zone) drives "overdue";
 * `pendingProofs` (v24) turns an open invoice into "verifying".
 */
export function toPublicInvoice(
  inv: InvoiceLike,
  items: readonly {
    description: string;
    qty: number | string;
    unit_price: number | string;
    position?: number | null;
  }[],
  payments: readonly { paid_at: string; amount: number | string }[],
  today: string,
  pendingProofs = 0,
): PublicInvoice | null {
  if (!isPublicStatus(inv.status)) return null;
  const total = Number(inv.total) || 0;
  const paid = Number(inv.paid) || 0;
  return {
    number: String(inv.number),
    issue_date: day(inv.issue_date) ?? "",
    due_date: day(inv.due_date),
    customer_name: String(inv.customer_name),
    currency: inv.currency || "IDR",
    status: displayStatus(
      { status: inv.status, due_date: inv.due_date ?? null },
      today,
      pendingProofs,
    ),
    items: [...items]
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map((i) => ({
        description: String(i.description),
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        amount: lineTotal(i.qty, i.unit_price),
      })),
    total,
    paid,
    remaining: remainingOf(total, paid),
    payments: [...payments]
      .map((p) => ({ paid_at: day(p.paid_at) ?? "", amount: Number(p.amount) || 0 }))
      .sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
  };
}
