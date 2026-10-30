/**
 * Pure, client-safe helpers for invoice payment methods and transfer proofs (v24, issue #94).
 * Unit-tested in src/test/invoice-payments.test.ts.
 *
 * - Payment methods (`payment_methods`): bank account or static QRIS image (≤200 KB raster data
 *   URL, same rule as the app logo). Optional `account_id` links a wallet for the admin only.
 * - Per invoice the admin may pick methods (`invoice_payment_methods`); none picked = every active
 *   method (`visibleMethods`).
 * - `toPublicMethod()` is the ONLY shape of a method that reaches a visitor: built field by field,
 *   never spread, so `account_id`, ids, `active`, `position` and timestamps never leave the server.
 *   The visitor refers to a method by its index in the public list (`ref`), never by id.
 * - Proofs: JPEG/PNG/WebP recognised by magic bytes (`sniffImage`), ≤ MAX_PROOF_BYTES, at most
 *   MAX_PENDING_PROOFS pending per invoice, claimed amount 0 < x ≤ remaining, short free text.
 */
import { isLogoDataUrl } from "./app-settings";

export const METHOD_KINDS = ["bank", "qris"] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];

export const METHOD_KIND_LABEL: Record<MethodKind, string> = {
  bank: "Transfer bank",
  qris: "QRIS",
};

export const MAX_METHODS = 20;
export const METHOD_LIMITS = { label: 60, bank_name: 60, account_number: 40, account_holder: 80 };

export const PROOF_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export const PROOF_STATUS_LABEL: Record<ProofStatus, string> = {
  pending: "Menunggu verifikasi",
  approved: "Disetujui",
  rejected: "Ditolak",
};

/** Max decoded proof image size (bytes). */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
/** Max pending proofs per invoice; more uploads are refused until the admin reviews them. */
export const MAX_PENDING_PROOFS = 3;
export const PROOF_LIMITS = { payer_name: 80, note: 500, reject_reason: 300 };
/** Longest side of the proof image after the browser re-encodes it. */
export const PROOF_MAX_SIDE = 2000;

export type PaymentMethodRow = {
  id: string;
  kind: MethodKind | string;
  label: string;
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  qris_image: string | null;
  account_id?: string | null;
  active: boolean;
  position: number;
};

/* ---------------- text ---------------- */

/** Trims, drops control characters, collapses whitespace and cuts to `max` chars (null if empty). */
export function cleanText(v: unknown, max: number, multiline = false): string | null {
  if (typeof v !== "string") return null;
  let s = v.normalize("NFC").replace(multiline ? /[^\S\n]+/g : /\s+/g, " ");
  // eslint-disable-next-line no-control-regex
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  if (multiline) s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim().slice(0, max).trim();
  return s ? s : null;
}

/* ---------------- methods ---------------- */

export type MethodInput = {
  kind: MethodKind;
  label: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  qris_image?: string | null;
  account_id?: string | null;
  active?: boolean;
};

const ACCOUNT_NUMBER_RE = /^[0-9A-Za-z .-]{3,40}$/;

/** Indonesian i18n keys of every problem with a method (empty = valid). */
export function validateMethod(v: MethodInput): string[] {
  const e: string[] = [];
  if (!(METHOD_KINDS as readonly string[]).includes(v.kind)) e.push("Jenis metode tidak valid");
  if (!cleanText(v.label, METHOD_LIMITS.label)) e.push("Nama metode wajib diisi");
  if (v.kind === "bank") {
    if (!cleanText(v.bank_name, METHOD_LIMITS.bank_name)) e.push("Nama bank wajib diisi");
    const no = cleanText(v.account_number, METHOD_LIMITS.account_number);
    if (!no) e.push("Nomor rekening wajib diisi");
    else if (!ACCOUNT_NUMBER_RE.test(no)) e.push("Nomor rekening tidak valid");
    if (!cleanText(v.account_holder, METHOD_LIMITS.account_holder))
      e.push("Nama pemilik rekening wajib diisi");
  }
  if (v.kind === "qris" && v.qris_image != null && !isLogoDataUrl(v.qris_image))
    e.push("Gambar QRIS harus PNG/JPEG/WebP maksimal 200 KB");
  return e;
}

/** Normalised row values for insert/update (kind-specific fields cleared). */
export function methodValues(v: MethodInput) {
  const bank = v.kind === "bank";
  return {
    kind: v.kind,
    label: cleanText(v.label, METHOD_LIMITS.label) ?? "",
    bank_name: bank ? cleanText(v.bank_name, METHOD_LIMITS.bank_name) : null,
    account_number: bank ? cleanText(v.account_number, METHOD_LIMITS.account_number) : null,
    account_holder: cleanText(v.account_holder, METHOD_LIMITS.account_holder),
    qris_image: !bank && isLogoDataUrl(v.qris_image) ? v.qris_image : null,
    account_id: v.account_id || null,
    active: v.active ?? true,
  };
}

const byPosition = <T extends { position?: number | null; label?: string }>(a: T, b: T) =>
  (Number(a.position) || 0) - (Number(b.position) || 0) ||
  String(a.label ?? "").localeCompare(String(b.label ?? ""));

/**
 * Methods shown for one invoice: active ones, restricted to `selected` ids when the invoice has a
 * selection (empty/none = all active), ordered by position then label.
 */
export function visibleMethods<T extends Pick<PaymentMethodRow, "id" | "active" | "position">>(
  methods: readonly T[],
  selected: readonly string[] | null | undefined,
): T[] {
  const pick = new Set(selected ?? []);
  return methods
    .filter((m) => m.active && (pick.size === 0 || pick.has(m.id)))
    .sort(byPosition as (a: T, b: T) => number);
}

export type PublicMethod = {
  ref: number;
  kind: MethodKind;
  label: string;
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  qris_image: string | null;
};

/** Every key of a public method (tests assert nothing else leaks, e.g. account_id). */
export const PUBLIC_METHOD_KEYS = [
  "ref",
  "kind",
  "label",
  "bank_name",
  "account_number",
  "account_holder",
  "qris_image",
] as const;

/** Whitelists one method for the public page. `ref` = index in the visible list. */
export function toPublicMethod(m: PaymentMethodRow, ref: number): PublicMethod {
  const kind: MethodKind = m.kind === "qris" ? "qris" : "bank";
  return {
    ref,
    kind,
    label: String(m.label ?? ""),
    bank_name: kind === "bank" ? (m.bank_name ?? null) : null,
    account_number: kind === "bank" ? (m.account_number ?? null) : null,
    account_holder: m.account_holder ?? null,
    qris_image: kind === "qris" && isLogoDataUrl(m.qris_image) ? m.qris_image : null,
  };
}

export function toPublicMethods(
  methods: readonly PaymentMethodRow[],
  selected: readonly string[] | null | undefined,
): PublicMethod[] {
  return visibleMethods(methods, selected).map((m, i) => toPublicMethod(m, i));
}

/** Payment block of the public invoice payload. */
export type PublicPayment = {
  methods: PublicMethod[];
  /** Pending proofs of this invoice (drives "proof received, awaiting verification"). */
  pending: number;
  /** Proof upload available (v24 ready, not demo, invoice open, pending < MAX_PENDING_PROOFS). */
  upload: boolean;
  /** Why upload is off (i18n key) or null. */
  upload_off: string | null;
};
export const PUBLIC_PAYMENT_KEYS = ["methods", "pending", "upload", "upload_off"] as const;

export const UPLOAD_OFF = {
  demo: "Unggah bukti dinonaktifkan di mode demo.",
  full: "Sudah ada beberapa bukti yang menunggu verifikasi. Tunggu konfirmasi penjual.",
  unavailable: "Unggah bukti belum tersedia untuk invoice ini.",
} as const;

export function publicPayment(o: {
  methods: readonly PaymentMethodRow[];
  selected: readonly string[] | null | undefined;
  pending: number;
  ready: boolean;
  demo: boolean;
  open: boolean;
}): PublicPayment {
  const pending = Math.max(0, Math.floor(Number(o.pending) || 0));
  const off =
    !o.ready || !o.open
      ? UPLOAD_OFF.unavailable
      : o.demo
        ? UPLOAD_OFF.demo
        : pending >= MAX_PENDING_PROOFS
          ? UPLOAD_OFF.full
          : null;
  return {
    methods: o.ready ? toPublicMethods(o.methods, o.selected) : [],
    pending: o.ready ? pending : 0,
    upload: off === null,
    upload_off: off,
  };
}

/** Method used for the invoice_payments row of an approved proof. */
export function paymentMethodOf(kind: string | null | undefined): "qris" | "transfer" {
  return kind === "qris" ? "qris" : "transfer";
}

/* ---------------- proof files ---------------- */

export type ImageType = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};

/** Image type from magic bytes (never from a declared MIME type), or null. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && PNG.every((x, i) => b[i] === x)) return { mime: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

const DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
/** Max data-URL length accepted before decoding (5 MB base64 + header). */
export const MAX_PROOF_DATA_URL = Math.ceil((MAX_PROOF_BYTES * 4) / 3) + 64;

/** Base64 payload of a proof data URL, or null when the shape/size is wrong. */
export function proofBase64(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_PROOF_DATA_URL) return null;
  const m = DATA_URL_RE.exec(dataUrl);
  return m ? m[1]! : null;
}

/** Problem with decoded proof bytes (i18n key) or the sniffed type. */
export function checkProofBytes(
  b: Uint8Array,
): { ok: true; type: ImageType } | { ok: false; error: string } {
  if (!b.length) return { ok: false, error: "Pilih foto bukti transfer" };
  if (b.length > MAX_PROOF_BYTES) return { ok: false, error: "Gambar maksimal 5 MB" };
  const type = sniffImage(b);
  if (!type) return { ok: false, error: "Format gambar tidak didukung (JPEG/PNG/WebP)." };
  return { ok: true, type };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROOF_PATH_RE = new RegExp(`^inv/(${UUID})/${UUID}\\.(?:jpg|png|webp)$`);

/** Storage path of a proof: `inv/<invoice id>/<random uuid>.<ext>` in the private receipts bucket. */
export function proofPath(invoiceId: string, random: string, ext: ImageType["ext"]): string {
  const p = `inv/${invoiceId.toLowerCase()}/${random.toLowerCase()}.${ext}`;
  if (!PROOF_PATH_RE.test(p)) throw new Error("invalid proof path");
  return p;
}

export function isProofPath(path: unknown, invoiceId?: string): boolean {
  if (typeof path !== "string") return false;
  const m = PROOF_PATH_RE.exec(path);
  return !!m && (!invoiceId || m[1] === invoiceId.toLowerCase());
}

/* ---------------- proof form ---------------- */

export type ProofInput = {
  claimed_amount: number;
  payer_name?: string | null;
  note?: string | null;
};

const EPS = 0.005;

/** i18n key of the first problem with a proof submission, or null. */
export function proofProblem(v: ProofInput, remaining: number): string | null {
  const a = Number(v.claimed_amount);
  if (!Number.isFinite(a) || a <= 0) return "Jumlah harus lebih dari 0";
  if (Math.abs(Math.round(a * 100) - a * 100) > 1e-6) return "Jumlah tidak valid";
  if (a > Number(remaining) + EPS) return "Jumlah melebihi sisa tagihan";
  return null;
}

/** Problem with approving a proof (i18n key) or null. */
export function approveProblem(
  proof: { status: string },
  inv: { status: string; total: number | string; paid: number | string },
  amount: number,
): string | null {
  if (proof.status !== "pending") return "Bukti ini sudah diproses";
  if (inv.status !== "unpaid" && inv.status !== "partial")
    return "Invoice ini tidak bisa menerima pembayaran";
  if (!Number.isFinite(amount) || amount <= 0) return "Jumlah harus lebih dari 0";
  const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
  if (amount > remaining + EPS) return "Pembayaran melebihi sisa tagihan";
  return null;
}

export function rejectProblem(reason: unknown): string | null {
  return cleanText(reason, PROOF_LIMITS.reject_reason, true)
    ? null
    : "Alasan penolakan wajib diisi";
}

/** Pending proof count per invoice id. */
export function pendingCounts(
  rows: readonly { invoice_id: string; status?: string | null }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows)
    if (!r.status || r.status === "pending") m.set(r.invoice_id, (m.get(r.invoice_id) ?? 0) + 1);
  return m;
}
