import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_PROOFS,
  MAX_PROOF_BYTES,
  PUBLIC_METHOD_KEYS,
  PUBLIC_PAYMENT_KEYS,
  UPLOAD_OFF,
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
  sniffImage,
  toPublicMethod,
  toPublicMethods,
  validateMethod,
  visibleMethods,
  type PaymentMethodRow,
} from "@/lib/invoice-payments";
import {
  PROOF_RATE_RULES,
  rateKey,
  retryAfterSeconds,
  windowStart,
  withinLimit,
} from "@/lib/rate-limit";
import { displayStatus, STATUS_LABEL } from "@/lib/invoices";
import { toPublicInvoice } from "@/lib/invoice-share";
import { RESTORE_TABLES, FK_COLUMNS, CONFLICT_KEYS } from "@/lib/backup";
import { SERVER_FN_ACCESS } from "@/lib/server-fn-access";
import { activityLabel } from "@/lib/activity";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const QRIS = `data:image/png;base64,${PNG_1PX}`;
const WALLET = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";
const RND = "33333333-3333-4333-8333-333333333333";

const method = (over: Partial<PaymentMethodRow> = {}): PaymentMethodRow => ({
  id: "m1",
  kind: "bank",
  label: "BCA",
  bank_name: "Bank Central Asia",
  account_number: "1234567890",
  account_holder: "Toko Contoh",
  qris_image: null,
  account_id: WALLET,
  active: true,
  position: 0,
  ...over,
});

describe("sniffImage / proof bytes", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))?.ext).toBe("jpg");
    expect(sniffImage(new Uint8Array(Buffer.from(PNG_1PX, "base64")))?.mime).toBe("image/png");
    const webp = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]);
    expect(sniffImage(webp)?.ext).toBe("webp");
  });
  it("rejects anything else, whatever the declared mime", () => {
    expect(sniffImage(new Uint8Array(Buffer.from("<svg xmlns=")))).toBeNull();
    expect(sniffImage(new Uint8Array(Buffer.from("GIF89a....")))).toBeNull();
    expect(sniffImage(new Uint8Array(Buffer.from("%PDF-1.7")))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array(Buffer.from("RIFF....AVI ")))).toBeNull();
    // An HTML file labelled as PNG still fails the bytes check.
    const html = Buffer.from("<html><script>alert(1)</script>").toString("base64");
    const b64 = proofBase64(`data:image/png;base64,${html}`)!;
    expect(checkProofBytes(new Uint8Array(Buffer.from(b64, "base64"))).ok).toBe(false);
  });
  it("enforces the 5 MB limit and non-empty files", () => {
    const big = new Uint8Array(MAX_PROOF_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(checkProofBytes(big)).toEqual({ ok: false, error: "Gambar maksimal 5 MB" });
    expect(checkProofBytes(new Uint8Array()).ok).toBe(false);
    const ok = checkProofBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]));
    expect(ok.ok && ok.type.mime).toBe("image/jpeg");
  });
  it("accepts only raster base64 data URLs of bounded length", () => {
    expect(proofBase64(QRIS)).toBe(PNG_1PX);
    expect(proofBase64("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(proofBase64("data:image/png;base64,abc$")).toBeNull();
    expect(proofBase64(`data:image/png;base64,${"A".repeat(7_100_000)}`)).toBeNull();
    expect(proofBase64(123)).toBeNull();
  });
  it("builds and checks private proof paths", () => {
    const p = proofPath(INV, RND, "jpg");
    expect(p).toBe(`inv/${INV}/${RND}.jpg`);
    expect(isProofPath(p, INV)).toBe(true);
    expect(isProofPath(p, RND)).toBe(false);
    expect(isProofPath(`inv/${INV}/../x.jpg`)).toBe(false);
    expect(() => proofPath("../etc", RND, "jpg")).toThrow();
  });
});

describe("rate-limit window math", () => {
  const H = 3_600_000;
  it("aligns windows and computes retry-after", () => {
    const now = Date.UTC(2026, 9, 30, 10, 42, 7);
    expect(windowStart(now, H)).toBe("2026-10-30T10:00:00.000Z");
    expect(windowStart(now, 24 * H)).toBe("2026-10-30T00:00:00.000Z");
    expect(retryAfterSeconds(now, H)).toBe(17 * 60 + 53);
    expect(windowStart(now + H, H)).toBe("2026-10-30T11:00:00.000Z");
  });
  it("builds keys from hashed subjects only", () => {
    expect(rateKey({ name: "proof:ip" }, "ABCdef01")).toBe("proof:ip:abcdef01");
    expect(rateKey({ name: "proof:ip" }, "1.2.3.4; drop")).toBe("proof:ip:1234drop");
    expect(rateKey({ name: "proof:ip" }, "")).toBe("proof:ip:none");
  });
  it("treats unknown counts as over the limit (fail closed)", () => {
    expect(withinLimit(1, 10)).toBe(true);
    expect(withinLimit(10, 10)).toBe(true);
    expect(withinLimit(11, 10)).toBe(false);
    expect(withinLimit(null, 10)).toBe(false);
    expect(withinLimit(0, 10)).toBe(false);
    expect(withinLimit(Number.NaN, 10)).toBe(false);
  });
  it("limits proofs per token and per IP", () => {
    expect(PROOF_RATE_RULES.token.length).toBeGreaterThan(0);
    expect(PROOF_RATE_RULES.ip.length).toBeGreaterThan(0);
    for (const r of [...PROOF_RATE_RULES.token, ...PROOF_RATE_RULES.ip])
      expect(r.limit).toBeGreaterThan(0);
  });
});

describe("payment methods", () => {
  it("validates bank and QRIS methods", () => {
    expect(validateMethod({ kind: "bank", label: "BCA" })).toEqual([
      "Nama bank wajib diisi",
      "Nomor rekening wajib diisi",
      "Nama pemilik rekening wajib diisi",
    ]);
    expect(
      validateMethod({
        kind: "bank",
        label: "BCA",
        bank_name: "BCA",
        account_number: "123<script>",
        account_holder: "A",
      }),
    ).toEqual(["Nomor rekening tidak valid"]);
    expect(validateMethod({ kind: "qris", label: "QRIS", qris_image: QRIS })).toEqual([]);
    expect(
      validateMethod({ kind: "qris", label: "QRIS", qris_image: "data:image/svg+xml;base64,AA==" }),
    ).toEqual(["Gambar QRIS harus PNG/JPEG/WebP maksimal 200 KB"]);
    expect(validateMethod({ kind: "x" as never, label: "" })).toContain("Jenis metode tidak valid");
  });
  it("normalises values and clears fields of the other kind", () => {
    const v = methodValues({
      kind: "qris",
      label: "  QRIS\u0000 Toko  ",
      bank_name: "BCA",
      account_number: "123",
      qris_image: QRIS,
    });
    expect(v.label).toBe("QRIS Toko");
    expect(v.bank_name).toBeNull();
    expect(v.account_number).toBeNull();
    expect(v.qris_image).toBe(QRIS);
    expect(methodValues({ kind: "bank", label: "B", qris_image: QRIS }).qris_image).toBeNull();
  });
  it("shows active methods, the invoice selection, in position order", () => {
    const ms = [
      method({ id: "a", position: 2, label: "A" }),
      method({ id: "b", position: 1, label: "B" }),
      method({ id: "c", active: false, label: "C" }),
    ];
    expect(visibleMethods(ms, []).map((m) => m.id)).toEqual(["b", "a"]);
    expect(visibleMethods(ms, null).map((m) => m.id)).toEqual(["b", "a"]);
    expect(visibleMethods(ms, ["a", "c"]).map((m) => m.id)).toEqual(["a"]);
    expect(visibleMethods(ms, ["zzz"])).toEqual([]);
  });
  it("never exposes account_id, ids or admin fields publicly", () => {
    const pub = toPublicMethods(
      [method(), method({ id: "q", kind: "qris", label: "QRIS", qris_image: QRIS, position: 1 })],
      [],
    );
    expect(pub).toHaveLength(2);
    for (const m of pub) expect(Object.keys(m).sort()).toEqual([...PUBLIC_METHOD_KEYS].sort());
    const json = JSON.stringify(pub);
    for (const secret of ['"account_id"', WALLET, '"id"', '"m1"', '"active"', '"position"'])
      expect(json).not.toContain(secret);
    expect(pub.map((m) => m.ref)).toEqual([0, 1]);
    expect(pub[1]!.bank_name).toBeNull();
    expect(pub[1]!.qris_image).toBe(QRIS);
  });
  it("drops an invalid stored QRIS image", () => {
    expect(
      toPublicMethod(method({ kind: "qris", qris_image: "javascript:x" }), 0).qris_image,
    ).toBeNull();
  });
  it("builds the public payment block (whitelist, upload switches)", () => {
    const base = {
      methods: [method()],
      selected: [],
      pending: 0,
      ready: true,
      demo: false,
      open: true,
    };
    const p = publicPayment(base);
    expect(Object.keys(p).sort()).toEqual([...PUBLIC_PAYMENT_KEYS].sort());
    expect(JSON.stringify(p)).not.toContain("account_id");
    expect(p.upload).toBe(true);
    expect(publicPayment({ ...base, demo: true })).toMatchObject({
      upload: false,
      upload_off: UPLOAD_OFF.demo,
    });
    expect(publicPayment({ ...base, pending: MAX_PENDING_PROOFS })).toMatchObject({
      upload: false,
      upload_off: UPLOAD_OFF.full,
    });
    expect(publicPayment({ ...base, ready: false })).toMatchObject({
      methods: [],
      upload: false,
      pending: 0,
    });
    expect(publicPayment({ ...base, open: false }).upload).toBe(false);
  });
  it("maps the method kind onto the invoice payment method", () => {
    expect(paymentMethodOf("qris")).toBe("qris");
    expect(paymentMethodOf("bank")).toBe("transfer");
    expect(paymentMethodOf(null)).toBe("transfer");
  });
});

describe("proof rules", () => {
  it("validates the claimed amount against the remaining amount", () => {
    expect(proofProblem({ claimed_amount: 100 }, 100)).toBeNull();
    expect(proofProblem({ claimed_amount: 0 }, 100)).toBe("Jumlah harus lebih dari 0");
    expect(proofProblem({ claimed_amount: -5 }, 100)).toBe("Jumlah harus lebih dari 0");
    expect(proofProblem({ claimed_amount: Number.NaN }, 100)).toBe("Jumlah harus lebih dari 0");
    expect(proofProblem({ claimed_amount: 100.5 }, 100)).toBe("Jumlah melebihi sisa tagihan");
    expect(proofProblem({ claimed_amount: 10.123 }, 100)).toBe("Jumlah tidak valid");
  });
  it("cleans free text", () => {
    expect(cleanText("  a\u0007b   c‮ ", 80)).toBe("ab c");
    expect(cleanText("x".repeat(100), 80)).toHaveLength(80);
    expect(cleanText("   ", 80)).toBeNull();
    expect(cleanText(42, 80)).toBeNull();
    expect(cleanText("a\n\n\n\nb", 500, true)).toBe("a\n\nb");
  });
  it("guards approval and rejection", () => {
    const inv = { status: "partial", total: 300, paid: 100 };
    expect(approveProblem({ status: "pending" }, inv, 200)).toBeNull();
    expect(approveProblem({ status: "approved" }, inv, 200)).toBe("Bukti ini sudah diproses");
    expect(approveProblem({ status: "pending" }, inv, 201)).toBe(
      "Pembayaran melebihi sisa tagihan",
    );
    expect(approveProblem({ status: "pending" }, { ...inv, status: "paid" }, 1)).toBe(
      "Invoice ini tidak bisa menerima pembayaran",
    );
    expect(rejectProblem("  ")).toBe("Alasan penolakan wajib diisi");
    expect(rejectProblem("Nominal tidak sesuai")).toBeNull();
  });
  it("counts pending proofs per invoice", () => {
    const m = pendingCounts([
      { invoice_id: "a", status: "pending" },
      { invoice_id: "a", status: "pending" },
      { invoice_id: "a", status: "rejected" },
      { invoice_id: "b", status: "pending" },
    ]);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
  });
});

describe("display status with pending proofs", () => {
  const today = "2026-10-30";
  it("shows Menunggu verifikasi for open invoices with pending proofs", () => {
    expect(displayStatus({ status: "unpaid" }, today, 1)).toBe("verifying");
    expect(displayStatus({ status: "partial", due_date: "2026-10-01" }, today, 2)).toBe(
      "verifying",
    );
    expect(displayStatus({ status: "unpaid", due_date: "2026-10-01" }, today, 0)).toBe("overdue");
    expect(displayStatus({ status: "paid" }, today, 1)).toBe("paid");
    expect(displayStatus({ status: "draft" }, today, 1)).toBe("draft");
    expect(displayStatus({ status: "unpaid" }, today)).toBe("unpaid");
    expect(STATUS_LABEL.verifying).toBe("Menunggu verifikasi");
  });
  it("flows into the public invoice payload", () => {
    const inv = {
      number: "INV-202610-0001",
      issue_date: "2026-10-01",
      customer_name: "A",
      status: "unpaid" as const,
      total: 100,
      paid: 0,
    };
    expect(toPublicInvoice(inv, [], [], today, 1)!.status).toBe("verifying");
    expect(toPublicInvoice(inv, [], [], today)!.status).toBe("unpaid");
  });
});

describe("wiring", () => {
  it("backs up methods, selections and proofs in FK order, never rate limits", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    expect(i("payment_methods")).toBeGreaterThan(i("accounts"));
    expect(i("invoice_payment_methods")).toBeGreaterThan(i("payment_methods"));
    expect(i("invoice_payment_methods")).toBeGreaterThan(i("invoices"));
    expect(i("invoice_proofs")).toBeGreaterThan(i("invoice_payments"));
    expect(i("invoice_proofs")).toBeGreaterThan(i("payment_methods"));
    expect(i("rate_limits")).toBe(-1);
    expect(FK_COLUMNS["method_id"]).toBe("payment_methods");
    expect(FK_COLUMNS["payment_id"]).toBe("invoice_payments");
    expect(CONFLICT_KEYS.invoice_payment_methods).toEqual(["invoice_id", "method_id"]);
  });
  it("classifies the upload as public and the queue as admin", () => {
    expect(SERVER_FN_ACCESS["invoice-public.functions.ts"]!["submitInvoiceProof"]).toBe("public");
    const a = SERVER_FN_ACCESS["invoices.functions.ts"]!;
    for (const fn of [
      "getPaymentMethodsFn",
      "savePaymentMethodFn",
      "deletePaymentMethodFn",
      "getInvoiceProofsFn",
      "getProofUrlFn",
      "approveProofFn",
      "rejectProofFn",
    ])
      expect(a[fn]).toBe("admin");
  });
  it("labels the new activity actions", () => {
    expect(activityLabel("invoice_proofs.approve")).toBe("Bukti transfer disetujui");
    expect(activityLabel("invoice_proofs.reject")).toBe("Bukti transfer ditolak");
    expect(activityLabel("payment_methods.create")).toBe("Metode pembayaran ditambahkan");
  });
});
