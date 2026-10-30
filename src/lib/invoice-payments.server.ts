/**
 * v24 invoice payment methods, public transfer proofs and the admin verification queue (issue #94).
 * Pure rules (validation, visibility, public shaping, file sniffing, proof checks) live in
 * ./invoice-payments.ts; rate-limit math in ./rate-limit.ts; this module only talks to the DB and
 * Storage.
 *
 * Security model of the public upload (`submitProof`)
 * - Disabled in demo (`assertNotDemo`). Rate limited persistently per IP hash and per token hash
 *   (`rateHit`, fails closed when v24 is missing or the DB errors).
 * - The token resolves through the same hashed lookup as the public page (`activeShareInvoiceId`);
 *   unknown/revoked/expired tokens and invoices that are not unpaid/partial all get the same
 *   PROOF_NOT_FOUND error.
 * - The image is decoded server-side, its type comes from magic bytes only, ≤5 MB, and it is stored
 *   in the private `receipts` bucket under `inv/<invoice id>/<random uuid>.<ext>`. Nobody gets a URL
 *   back; the admin views it through a 2-minute signed URL.
 * - At most MAX_PENDING_PROOFS pending proofs per invoice; the claimed amount is 0 < x ≤ remaining;
 *   free text is cleaned and length-limited. The response is only `{ ok: true }`.
 */
import { randomUUID } from "crypto";
import { db } from "./db.server";
import {
  MAX_METHODS,
  MAX_PENDING_PROOFS,
  PROOF_LIMITS,
  approveProblem,
  checkProofBytes,
  cleanText,
  isProofPath,
  methodValues,
  paymentMethodOf,
  pendingCounts,
  proofBase64,
  proofPath,
  proofProblem,
  publicPayment,
  rejectProblem,
  validateMethod,
  visibleMethods,
  type MethodInput,
  type PaymentMethodRow,
  type ProofStatus,
  type PublicPayment,
} from "./invoice-payments";
import { remainingOf } from "./invoices";
import { PROOF_RATE_RULES } from "./rate-limit";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const V24_MISSING =
  "Metode pembayaran invoice belum aktif: jalankan bagian v24 di supabase/schema.sql.";
/** Uniform public error for every "this invoice cannot take a proof" case (no oracle). */
export const PROOF_NOT_FOUND = "Invoice tidak ditemukan atau tidak bisa menerima bukti.";
export const PROOF_RATE_LIMITED = "Terlalu banyak unggahan, coba lagi nanti.";
export const PROOF_FAILED = "Bukti gagal dikirim, coba lagi.";

const BUCKET = "receipts";
/** Signed preview URL lifetime for the admin (seconds). */
const PROOF_URL_TTL = 120;

const fin = () => import("./finance.server");

/** Columns safe for the public page: never `account_id`. */
const PUBLIC_METHOD_COLS =
  "id, kind, label, bank_name, account_number, account_holder, qris_image, active, position";

async function missing(err: { message?: string; code?: string } | null | undefined) {
  return (await fin()).isMissingTable(err);
}

/* ---------------- methods (admin) ---------------- */

export async function listMethods() {
  const res = await db().from("payment_methods").select("*").order("position").order("label");
  if (res.error) {
    if (await missing(res.error)) return { ready: false as const, methods: [] };
    throw new Error(res.error.message);
  }
  return { ready: true as const, methods: res.data ?? [] };
}

export async function saveMethod(id: string | null, v: MethodInput) {
  const errors = validateMethod(v);
  if (errors.length) throw new Error(errors[0]);
  const values = methodValues(v);
  if (id) {
    const res = await db()
      .from("payment_methods")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (res.error) {
      if (await missing(res.error)) throw new Error(V24_MISSING);
      throw new Error(res.error.message);
    }
    if (!res.data) throw new Error("Metode tidak ditemukan");
    await (
      await fin()
    ).logActivity("payment_methods.update", "payment_methods", {
      name: values.label,
    });
    return res.data;
  }
  const count = await db().from("payment_methods").select("id", { count: "exact", head: true });
  if (count.error) {
    if (await missing(count.error)) throw new Error(V24_MISSING);
    throw new Error(count.error.message);
  }
  if ((count.count ?? 0) >= MAX_METHODS) throw new Error("Terlalu banyak metode (maks. 20)");
  const res = await db()
    .from("payment_methods")
    .insert({ ...values, position: count.count ?? 0 })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  await (
    await fin()
  ).logActivity("payment_methods.create", "payment_methods", {
    name: values.label,
  });
  return res.data;
}

export async function deleteMethod(id: string) {
  const res = await db().from("payment_methods").delete().eq("id", id).select("label");
  if (res.error) {
    if (await missing(res.error)) throw new Error(V24_MISSING);
    throw new Error(res.error.message);
  }
  if (res.data?.length)
    await (
      await fin()
    ).logActivity("payment_methods.delete", "payment_methods", {
      name: res.data[0]!.label,
    });
  return { ok: true };
}

/* ---------------- per-invoice selection ---------------- */

/** Ids picked for an invoice ([] = all active, also when v24 is missing). */
export async function invoiceMethodIds(invoiceId: string): Promise<string[]> {
  const res = await db()
    .from("invoice_payment_methods")
    .select("method_id")
    .eq("invoice_id", invoiceId);
  if (res.error) return [];
  return (res.data ?? []).map((r) => r.method_id);
}

/**
 * Replaces the selection of an invoice. `undefined` = leave unchanged (older clients). Without v24
 * an empty selection is a no-op and a non-empty one fails with the "run v24" message.
 */
export async function setInvoiceMethods(invoiceId: string, ids: readonly string[] | undefined) {
  if (ids === undefined) return;
  const unique = [...new Set(ids)].slice(0, MAX_METHODS);
  const del = await db().from("invoice_payment_methods").delete().eq("invoice_id", invoiceId);
  if (del.error) {
    if (await missing(del.error)) {
      if (unique.length) throw new Error(V24_MISSING);
      return;
    }
    throw new Error(del.error.message);
  }
  if (!unique.length) return;
  const known = await db().from("payment_methods").select("id").in("id", unique);
  if (known.error) throw new Error(known.error.message);
  const ok = new Set((known.data ?? []).map((r) => r.id));
  const rows = unique
    .filter((m) => ok.has(m))
    .map((method_id) => ({ invoice_id: invoiceId, method_id }));
  if (!rows.length) return;
  const ins = await db().from("invoice_payment_methods").insert(rows);
  if (ins.error) throw new Error(ins.error.message);
}

/* ---------------- pending counts (display status) ---------------- */

/** Pending proof count per invoice id ({} without v24 or on error: display falls back). */
export async function pendingProofCounts(ids: readonly string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const res = await db()
    .from("invoice_proofs")
    .select("invoice_id, status")
    .eq("status", "pending")
    .in("invoice_id", [...ids]);
  if (res.error) return new Map();
  return pendingCounts(res.data ?? []);
}

/* ---------------- public page ---------------- */

async function visibleRows(invoiceId: string) {
  const [methods, selected] = await Promise.all([
    db().from("payment_methods").select(PUBLIC_METHOD_COLS).eq("active", true),
    db().from("invoice_payment_methods").select("method_id").eq("invoice_id", invoiceId),
  ]);
  if (methods.error || selected.error) return null;
  return {
    methods: (methods.data ?? []) as unknown as PaymentMethodRow[],
    selected: (selected.data ?? []).map((r) => r.method_id),
  };
}

/** Payment block of the public page (methods whitelist, pending count, upload flag). */
export async function publicPaymentFor(
  invoiceId: string,
  status: string,
  demo: boolean,
): Promise<PublicPayment> {
  const open = status === "unpaid" || status === "partial";
  const off = publicPayment({ methods: [], selected: [], pending: 0, ready: false, demo, open });
  try {
    const [rows, pending] = await Promise.all([
      visibleRows(invoiceId),
      db()
        .from("invoice_proofs")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", invoiceId)
        .eq("status", "pending"),
    ]);
    if (!rows || pending.error) return off;
    return publicPayment({
      methods: rows.methods,
      selected: rows.selected,
      pending: pending.count ?? 0,
      ready: true,
      demo,
      open,
    });
  } catch {
    return off;
  }
}

/* ---------------- public proof upload ---------------- */

export type ProofSubmission = {
  token: string;
  method_ref: number | null;
  claimed_amount: number;
  payer_name: string | null;
  note: string | null;
  image: string;
};

async function ensureBucket() {
  const { error } = await db().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

async function removeFile(path: string) {
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) console.error("remove proof failed", error.message);
}

/**
 * Public upload. Throws only the fixed public messages (PROOF_NOT_FOUND, PROOF_RATE_LIMITED,
 * validation i18n keys, PROOF_FAILED); internal errors are logged, never echoed.
 */
export async function submitProof(s: ProofSubmission, ip: string): Promise<{ ok: true }> {
  const { activeShareInvoiceId, hashShareToken } = await import("./invoice-share.server");
  const { normalizeShareToken } = await import("./invoice-share");
  const { rateHit, subjectHash } = await import("./rate-limit.server");

  const token = normalizeShareToken(s.token);
  // Cheap shape checks before any DB access.
  const b64 = proofBase64(s.image);
  if (!b64) throw new Error("Format gambar tidak didukung (JPEG/PNG/WebP).");

  if (!(await rateHit(PROOF_RATE_RULES.ip, subjectHash(`ip:${ip}`))))
    throw new Error(PROOF_RATE_LIMITED);
  if (!token) throw new Error(PROOF_NOT_FOUND);
  if (!(await rateHit(PROOF_RATE_RULES.token, subjectHash(`token:${hashShareToken(token)}`))))
    throw new Error(PROOF_RATE_LIMITED);

  const invoiceId = await activeShareInvoiceId(token);
  if (!invoiceId) throw new Error(PROOF_NOT_FOUND);
  const inv = await db()
    .from("invoices")
    .select("id, status, total, paid")
    .eq("id", invoiceId)
    .maybeSingle();
  if (inv.error || !inv.data) throw new Error(PROOF_NOT_FOUND);
  if (inv.data.status !== "unpaid" && inv.data.status !== "partial")
    throw new Error(PROOF_NOT_FOUND);

  const payer_name = cleanText(s.payer_name, PROOF_LIMITS.payer_name);
  const note = cleanText(s.note, PROOF_LIMITS.note, true);
  const problem = proofProblem(
    { claimed_amount: s.claimed_amount, payer_name, note },
    remainingOf(inv.data.total, inv.data.paid),
  );
  if (problem) throw new Error(problem);

  const pending = await db()
    .from("invoice_proofs")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("status", "pending");
  if (pending.error) throw new Error(PROOF_FAILED);
  if ((pending.count ?? 0) >= MAX_PENDING_PROOFS)
    throw new Error(
      "Sudah ada beberapa bukti yang menunggu verifikasi. Tunggu konfirmasi penjual.",
    );

  let methodId: string | null = null;
  if (s.method_ref != null) {
    const rows = await visibleRows(invoiceId);
    const m = rows ? visibleMethods(rows.methods, rows.selected)[s.method_ref] : undefined;
    methodId = m?.id ?? null;
  }

  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  const check = checkProofBytes(bytes);
  if (!check.ok) throw new Error(check.error);

  const path = proofPath(invoiceId, randomUUID(), check.type.ext);
  try {
    await ensureBucket();
    const up = await db()
      .storage.from(BUCKET)
      .upload(path, Buffer.from(bytes), { contentType: check.type.mime, upsert: false });
    if (up.error) throw new Error(up.error.message);
  } catch (e) {
    (await import("./monitoring.server")).logError("public:proof-upload", e);
    throw new Error(PROOF_FAILED);
  }
  const ins = await db()
    .from("invoice_proofs")
    .insert({
      invoice_id: invoiceId,
      method_id: methodId,
      file_path: path,
      claimed_amount: Math.round(Number(s.claimed_amount) * 100) / 100,
      payer_name,
      note,
      ip_hash: subjectHash(`ip:${ip}`),
    });
  if (ins.error) {
    await removeFile(path);
    (await import("./monitoring.server")).logError("public:proof-insert", ins.error);
    throw new Error(PROOF_FAILED);
  }
  await (
    await fin()
  ).logActivity("invoice_proofs.create", "invoice_proofs", {
    amount: Number(s.claimed_amount),
    currency: "IDR",
  });
  return { ok: true };
}

/* ---------------- admin queue ---------------- */

export type ProofListOptions = {
  status: ProofStatus | "all";
  offset: number;
  limit: number;
  invoice?: string | undefined;
};

/** Paginated proofs with their invoice (number, customer, remaining) and method label. */
export async function listProofs(o: ProofListOptions, scope: readonly string[] | null) {
  let q: any = db()
    .from("invoice_proofs")
    .select(
      "id, invoice_id, method_id, claimed_amount, payer_name, note, status, reject_reason, created_at, reviewed_at, payment_id, invoices!inner(number, customer_name, status, total, paid, account_id), payment_methods(label, kind)",
      { count: "exact" },
    );
  if (o.status !== "all") q = q.eq("status", o.status);
  if (o.invoice) q = q.eq("invoice_id", o.invoice);
  if (scope) q = q.in("invoices.account_id", [...scope]);
  q = q
    .order("created_at", { ascending: o.status === "pending" })
    .range(o.offset, o.offset + o.limit - 1);
  const [list, pending] = await Promise.all([
    q,
    db()
      .from("invoice_proofs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  if (list.error || pending.error) {
    if ((await missing(list.error)) || (await missing(pending.error)))
      return { ready: false as const };
    throw new Error((list.error ?? pending.error)!.message);
  }
  const items = ((list.data ?? []) as any[]).map((p) => ({
    id: p.id as string,
    invoice_id: p.invoice_id as string,
    claimed_amount: Number(p.claimed_amount),
    payer_name: p.payer_name as string | null,
    note: p.note as string | null,
    status: p.status as ProofStatus,
    reject_reason: p.reject_reason as string | null,
    created_at: p.created_at as string,
    reviewed_at: p.reviewed_at as string | null,
    payment_id: p.payment_id as string | null,
    method: p.payment_methods
      ? { label: p.payment_methods.label, kind: p.payment_methods.kind }
      : null,
    invoice: {
      number: p.invoices.number as string,
      customer_name: p.invoices.customer_name as string,
      status: p.invoices.status as string,
      remaining: remainingOf(p.invoices.total, p.invoices.paid),
    },
  }));
  return {
    ready: true as const,
    items,
    total: list.count ?? items.length,
    pending: pending.count ?? 0,
  };
}

export async function loadProof(id: string) {
  const res = await db().from("invoice_proofs").select("*").eq("id", id).maybeSingle();
  if (res.error) {
    if (await missing(res.error)) throw new Error(V24_MISSING);
    throw new Error(res.error.message);
  }
  return res.data;
}

/** Short-lived signed URL of a proof image (admin only). */
export async function proofUrl(proof: { invoice_id: string; file_path: string }) {
  if (!isProofPath(proof.file_path, proof.invoice_id)) throw new Error("Berkas bukti tidak valid");
  const { data, error } = await db()
    .storage.from(BUCKET)
    .createSignedUrl(proof.file_path, PROOF_URL_TTL);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

type InvoiceRow = import("./invoices.server").InvoiceRow;

/**
 * Approves a pending proof: claims it with a conditional update (`status = 'pending'`) so a double
 * click / second admin tab cannot book twice, then books the payment through `recordPayment()`
 * (income `invoice_pay:<id>`). On failure the claim is released again.
 */
export async function approveProof(
  proof: { id: string; status: string; method_id: string | null; payer_name: string | null },
  inv: InvoiceRow,
  amount: number,
  paidAt: string | null,
) {
  const problem = approveProblem(proof, inv, amount);
  if (problem) throw new Error(problem);
  const now = new Date().toISOString();
  const claim = await db()
    .from("invoice_proofs")
    .update({ status: "approved", reviewed_at: now, reject_reason: null })
    .eq("id", proof.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) throw new Error("Bukti ini sudah diproses");

  let kind: string | null = null;
  if (proof.method_id) {
    const m = await db()
      .from("payment_methods")
      .select("kind")
      .eq("id", proof.method_id)
      .maybeSingle();
    kind = m.data?.kind ?? null;
  }
  const s = await import("./invoices.server");
  let booked: { invoice: InvoiceRow; paymentId: string };
  try {
    booked = await s.bookPayment(inv, {
      amount,
      paid_at: paidAt,
      method: paymentMethodOf(kind),
      reference: `proof:${proof.id.slice(0, 8)}`,
      note: proof.payer_name ? `Bukti dari ${proof.payer_name}` : "Bukti transfer pelanggan",
    });
  } catch (e) {
    // Release the claim so the proof can be approved again (or rejected).
    await db()
      .from("invoice_proofs")
      .update({ status: "pending", reviewed_at: null })
      .eq("id", proof.id)
      .eq("status", "approved")
      .is("payment_id", null);
    throw e;
  }
  await db().from("invoice_proofs").update({ payment_id: booked.paymentId }).eq("id", proof.id);
  await (
    await fin()
  ).logActivity("invoice_proofs.approve", "invoice_proofs", {
    name: `${inv.number} · ${inv.customer_name}`,
    amount,
    currency: "IDR",
  });
  return booked.invoice;
}

export async function rejectProof(proof: { id: string }, inv: InvoiceRow, reason: string) {
  const problem = rejectProblem(reason);
  if (problem) throw new Error(problem);
  const res = await db()
    .from("invoice_proofs")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reject_reason: cleanText(reason, PROOF_LIMITS.reject_reason, true),
    })
    .eq("id", proof.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("Bukti ini sudah diproses");
  await (
    await fin()
  ).logActivity("invoice_proofs.reject", "invoice_proofs", {
    name: `${inv.number} · ${inv.customer_name}`,
  });
  return { ok: true };
}

/** Removes the stored proof images of an invoice (before deleting it). Never throws. */
export async function removeInvoiceProofFiles(invoiceId: string) {
  try {
    const res = await db().from("invoice_proofs").select("file_path").eq("invoice_id", invoiceId);
    if (res.error) return;
    const paths = (res.data ?? []).map((r) => r.file_path).filter((p) => isProofPath(p, invoiceId));
    if (paths.length) await db().storage.from(BUCKET).remove(paths);
  } catch {
    /* best effort */
  }
}

/** Text-only payment methods for emails (#95): the same visible list as the public page, no images. */
export async function emailMethodsFor(invoiceId: string) {
  try {
    const rows = await visibleRows(invoiceId);
    if (!rows) return [];
    return visibleMethods(rows.methods, rows.selected).map((m) => ({
      kind: m.kind === "qris" ? "qris" : "bank",
      label: String(m.label ?? ""),
      bank_name: m.bank_name ?? null,
      account_number: m.account_number ?? null,
      account_holder: m.account_holder ?? null,
    }));
  } catch {
    return [];
  }
}
