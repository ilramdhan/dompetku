/**
 * v23 public invoice links (issue #93). Pure token format, expiry, wa.me and the public payload
 * whitelist live in ./invoice-share.ts; this module only hashes tokens and talks to the DB.
 *
 * Security model
 * - Token: 32 bytes from node `randomBytes` as base64url. Only `sha256(token)` (hex) is stored in
 *   `invoice_shares.token_hash` (unique index), so a DB/backup leak never yields a working link and
 *   the lookup is a plain equality on the hash (no string compare of the secret itself).
 * - `publicInvoiceByToken()` returns null for EVERY failure (bad format, unknown hash, revoked,
 *   expired, draft/cancelled, missing v21/v23 tables, DB error) so the route answers the same 404.
 * - The visitor only ever gets `toPublicInvoice()` (whitelist; no wallet, notes, ids, references).
 * - Admin side (create/rotate/revoke/status) is called from requireAdmin server fns only.
 */
import { createHash, randomBytes } from "crypto";
import { db } from "./db.server";
import {
  SHARE_TOKEN_BYTES,
  isPublicStatus,
  normalizeShareToken,
  shareExpiresAt,
  shareState,
  toBase64Url,
  toPublicInvoice,
  type PublicInvoiceView,
  type ShareState,
} from "./invoice-share";
import type { InvoiceRow } from "./invoices.server";

export const V23_MISSING =
  "Tautan publik invoice belum aktif: jalankan bagian v23 di supabase/schema.sql.";

const fin = () => import("./finance.server");

/** SHA-256 hex of a token (what is stored and looked up). */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newShareToken(): string {
  return toBase64Url(new Uint8Array(randomBytes(SHARE_TOKEN_BYTES)));
}

export type ShareStatus =
  | { ready: false }
  | {
      ready: true;
      state: ShareState;
      created_at: string | null;
      expires_at: string | null;
    };

/** Link status for the admin (never the token: only its hash exists). */
export async function shareStatus(invoiceId: string): Promise<ShareStatus> {
  const res = await db()
    .from("invoice_shares")
    .select("created_at, expires_at, revoked_at")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (res.error) {
    if ((await fin()).isMissingTable(res.error)) return { ready: false };
    throw new Error(res.error.message);
  }
  const row = res.data;
  return {
    ready: true,
    state: shareState(row, new Date()),
    created_at: row?.created_at ?? null,
    expires_at: row?.expires_at ?? null,
  };
}

/**
 * Creates or rotates the link of an issued invoice: a fresh token replaces the stored hash (the old
 * link stops working). Returns the raw token — the only time it exists outside the visitor's URL.
 */
export async function createShare(
  inv: InvoiceRow,
  expiresInDays: number | null,
  demo: boolean,
): Promise<{ token: string; expires_at: string | null; created_at: string }> {
  if (!isPublicStatus(inv.status))
    throw new Error("Terbitkan invoice dulu; draft dan invoice batal tidak bisa dibagikan");
  const token = newShareToken();
  const now = new Date();
  const row = {
    invoice_id: inv.id,
    token_hash: hashShareToken(token),
    created_at: now.toISOString(),
    expires_at: shareExpiresAt(expiresInDays, now, demo),
    revoked_at: null,
  };
  const res = await db().from("invoice_shares").upsert(row, { onConflict: "invoice_id" });
  if (res.error) {
    if ((await fin()).isMissingTable(res.error)) throw new Error(V23_MISSING);
    throw new Error(res.error.message);
  }
  await (
    await fin()
  ).logActivity("invoice_shares.create", "invoice_shares", {
    name: `${inv.number} · ${inv.customer_name}`,
  });
  return { token, expires_at: row.expires_at, created_at: row.created_at };
}

/** Revokes the link (kept as a row so the admin sees "revoked"; rotating issues a new one). */
export async function revokeShare(inv: InvoiceRow) {
  const res = await db()
    .from("invoice_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("invoice_id", inv.id)
    .is("revoked_at", null);
  if (res.error) {
    if ((await fin()).isMissingTable(res.error)) throw new Error(V23_MISSING);
    throw new Error(res.error.message);
  }
  await (
    await fin()
  ).logActivity("invoice_shares.delete", "invoice_shares", {
    name: `${inv.number} · ${inv.customer_name}`,
  });
  return { ok: true };
}

/**
 * Invoice id behind an active (not revoked/expired) share token, or null. Used by the public page
 * and the v24 proof upload; every failure is null.
 */
export async function activeShareInvoiceId(raw: unknown): Promise<string | null> {
  const token = normalizeShareToken(raw);
  if (!token) return null;
  const share = await db()
    .from("invoice_shares")
    .select("invoice_id, created_at, expires_at, revoked_at")
    .eq("token_hash", hashShareToken(token))
    .maybeSingle();
  if (share.error || !share.data) return null;
  if (shareState(share.data, new Date()) !== "active") return null;
  return share.data.invoice_id;
}

/**
 * The customer view of the invoice behind `token`, or null (uniform "not found") for every
 * failure. Selects only the columns the public payload needs. The v24 payment block degrades to
 * "no methods, no upload" when v24 is missing.
 */
export async function publicInvoiceByToken(raw: unknown): Promise<PublicInvoiceView | null> {
  try {
    const id = await activeShareInvoiceId(raw);
    if (!id) return null;
    const inv = await db()
      .from("invoices")
      .select("number, issue_date, due_date, customer_name, currency, status, total, paid")
      .eq("id", id)
      .maybeSingle();
    if (inv.error || !inv.data || !isPublicStatus(inv.data.status)) return null;
    const [items, pays, f, pm, demo] = await Promise.all([
      db()
        .from("invoice_items")
        .select("description, qty, unit_price, position")
        .eq("invoice_id", id)
        .order("position"),
      // "*" so v25 `refunded` is netted out (works before v25 too); only paid_at/amount leave.
      db().from("invoice_payments").select("*").eq("invoice_id", id).order("paid_at"),
      fin(),
      import("./invoice-payments.server"),
      import("./demo.server"),
    ]);
    if (items.error || pays.error) return null;
    const payment = await pm.publicPaymentFor(id, inv.data.status, demo.isDemo());
    const pub = toPublicInvoice(
      inv.data,
      items.data ?? [],
      pays.data ?? [],
      f.today(),
      payment.pending,
    );
    if (!pub) return null;
    // v25: Midtrans "Bayar sekarang" (false before v25, unconfigured, in demo or when not open).
    const gw = await (
      await import("./gateway/payments.server")
    ).publicGatewayFor(inv.data.status, pub.remaining, demo.isDemo());
    return { ...pub, payment: { ...payment, gateway: gw.available } };
  } catch (e) {
    try {
      (await import("./monitoring.server")).logError("public:invoice", e);
    } catch {
      /* never fail the lookup on logging */
    }
    return null;
  }
}
