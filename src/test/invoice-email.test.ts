import { describe, expect, it } from "vitest";
import { buildInvoiceEmail, type InvoiceEmailInput } from "@/lib/email";
import {
  dedupeWindowDays,
  isEmailAddress,
  leadDays,
  maskEmail,
  reminderStage,
} from "@/lib/invoice-email";

const base: InvoiceEmailInput = {
  kind: "invoice",
  number: "INV-202610-0001",
  customer_name: "Budi",
  due_date: "2026-10-20",
  total: 1500000,
  paid: 500000,
  remaining: 1000000,
  today: "2026-10-18",
  link: "https://x.test/i/abc",
  methods: [
    { kind: "bank", label: "BCA", bank_name: "BCA", account_number: "123", account_holder: "Toko" },
    { kind: "qris", label: "QRIS Toko" },
  ],
};

describe("buildInvoiceEmail", () => {
  it("builds the invoice mail with summary, link and payment instructions", () => {
    const m = buildInvoiceEmail(base);
    expect(m.subject).toContain("INV-202610-0001");
    expect(m.text).toContain("Sisa tagihan");
    expect(m.text).toContain("2 hari lagi");
    expect(m.text).toContain("BCA 123 a.n. Toko");
    expect(m.text).toContain("QRIS");
    expect(m.text).toContain("https://x.test/i/abc");
    expect(m.html).toContain('href="https://x.test/i/abc"');
    expect(m.html).not.toContain("<img");
  });
  it("supports English", () => {
    const m = buildInvoiceEmail({ ...base, lang: "en" });
    expect(m.text).toContain("Amount due");
    expect(m.subject).toContain("from Dompetku");
  });
  it("escapes customer input in html and strips newlines from the subject", () => {
    const m = buildInvoiceEmail({
      ...base,
      customer_name: '<script>x</script>"',
      number: "INV\r\nBcc: a@b.c",
      brand: "A&B",
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A&amp;B");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
  it("drops non-http links", () => {
    const m = buildInvoiceEmail({ ...base, link: "javascript:alert(1)" });
    expect(m.html).not.toContain("javascript:");
    expect(m.text).toContain("minta kode QRIS");
  });
  it("payment mail has no methods and no link, and flags a fully paid invoice", () => {
    const part = buildInvoiceEmail({
      ...base,
      kind: "payment",
      link: null,
      payment_amount: 500000,
    });
    expect(part.subject).toContain("diterima");
    expect(part.text).not.toContain("Cara pembayaran");
    expect(part.text).toContain("Pembayaran diterima");
    const full = buildInvoiceEmail({
      ...base,
      kind: "payment",
      link: null,
      paid: 1500000,
      remaining: 0,
    });
    expect(full.subject).toContain("lunas");
    expect(full.text).toContain("sudah lunas");
  });
  it("overdue and due-soon subjects count days", () => {
    expect(buildInvoiceEmail({ ...base, kind: "overdue", today: "2026-10-25" }).subject).toContain(
      "terlambat 5 hari",
    );
    expect(
      buildInvoiceEmail({ ...base, kind: "reminder_due", today: "2026-10-20" }).subject,
    ).toContain("hari ini");
  });
  it("never masks amounts", () => {
    expect(buildInvoiceEmail(base).text).toMatch(/Rp\s?1\.000\.000/);
  });
});

describe("invoice-email helpers", () => {
  it("masks the address", () => {
    expect(maskEmail("ilham@gmail.com")).toBe("i***m@gmail.com");
    expect(maskEmail("ab@x.id")).toBe("a***@x.id");
    expect(maskEmail("nope")).toBe("***");
    expect(maskEmail(null)).toBe("***");
  });
  it("validates one address", () => {
    expect(isEmailAddress("a@b.co")).toBe(true);
    expect(isEmailAddress("a@b.co, c@d.co")).toBe(false);
    expect(isEmailAddress("a b@c.co")).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
  });
  it("clamps the lead time", () => {
    expect(leadDays(undefined)).toBe(3);
    expect(leadDays(7)).toBe(7);
    expect(leadDays(0)).toBe(0);
    expect(leadDays(99)).toBe(3);
  });
  it("picks the reminder stage", () => {
    const i = (status: string, due: string | null, remaining = 100) => ({
      status,
      due_date: due,
      remaining,
    });
    const today = "2026-10-18";
    expect(reminderStage(i("unpaid", "2026-10-17"), today)).toBe("overdue");
    expect(reminderStage(i("partial", "2026-10-21"), today)).toBe("reminder_due");
    expect(reminderStage(i("unpaid", "2026-10-22"), today)).toBeNull();
    expect(reminderStage(i("unpaid", "2026-10-22"), today, 5)).toBe("reminder_due");
    expect(reminderStage(i("paid", "2026-10-10", 0), today)).toBeNull();
    expect(reminderStage(i("draft", "2026-10-10"), today)).toBeNull();
    expect(reminderStage(i("unpaid", null), today)).toBeNull();
    expect(reminderStage(i("unpaid", "2026-10-10", 0), today)).toBeNull();
  });
  it("dedupes overdue weekly and due-soon once", () => {
    expect(dedupeWindowDays("overdue")).toBe(7);
    expect(dedupeWindowDays("reminder_due")).toBeGreaterThan(30);
  });
});
