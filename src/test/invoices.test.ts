import { describe, expect, it } from "vitest";
import {
  actionTarget,
  availableActions,
  canEditInvoice,
  canRecordPayment,
  derivedStatus,
  displayStatus,
  editProblem,
  formatInvoiceNumber,
  invoiceSummary,
  invoiceTotal,
  isOverdue,
  itemsFromRows,
  lineTotal,
  nextInvoiceNumber,
  normalizePrefix,
  paidSum,
  parseInvoiceNumber,
  paymentExternalId,
  paymentProblem,
  remainingOf,
  validateInvoice,
  validateInvoiceSearch,
  type InvoiceDraft,
  type InvoiceStatus,
} from "@/lib/invoices";
import { activityLabel } from "@/lib/activity";
import { resolveSettings } from "@/lib/app-settings";
import { appSettingsInputSchema } from "@/lib/app-settings-schema";
import { RESTORE_TABLES, CONFLICT_KEYS, FK_COLUMNS } from "@/lib/backup";
import { ADMIN_MODULES, canOpenPath } from "@/lib/permissions";

const A = "11111111-1111-4111-8111-111111111111";

describe("invoice totals", () => {
  it("computes line and invoice totals rounded to cents", () => {
    expect(lineTotal(3, 15_000)).toBe(45_000);
    expect(lineTotal("1.5", "1000.333")).toBe(1500.5);
    expect(lineTotal("x", 10)).toBe(0);
    expect(
      invoiceTotal([
        { qty: 2, unit_price: 250_000 },
        { qty: 1, unit_price: 99_999.99 },
      ]),
    ).toBe(599_999.99);
    expect(invoiceTotal([])).toBe(0);
  });
  it("sums payments and never returns a negative remaining", () => {
    expect(paidSum([{ amount: 100 }, { amount: "50.5" }])).toBe(150.5);
    expect(remainingOf(1000, 400)).toBe(600);
    expect(remainingOf(1000, 1200)).toBe(0);
  });
});

describe("status", () => {
  it("derives unpaid/partial/paid from payments and keeps manual states", () => {
    expect(derivedStatus("unpaid", 1000, 0)).toBe("unpaid");
    expect(derivedStatus("unpaid", 1000, 1)).toBe("partial");
    expect(derivedStatus("partial", 1000, 1000)).toBe("paid");
    expect(derivedStatus("paid", 1000, 500)).toBe("partial");
    expect(derivedStatus("paid", 1000, 0)).toBe("unpaid");
    expect(derivedStatus("draft", 1000, 1000)).toBe("draft");
    expect(derivedStatus("cancelled", 1000, 0)).toBe("cancelled");
  });
  it("allows only the documented manual transitions", () => {
    const inv = (status: InvoiceStatus, paid = 0, total = 1000) => ({ status, paid, total });
    expect(actionTarget("issue", inv("draft"))).toBe("unpaid");
    expect(actionTarget("issue", inv("draft", 0, 0))).toBeNull();
    expect(actionTarget("issue", inv("unpaid"))).toBeNull();
    expect(actionTarget("cancel", inv("draft"))).toBe("cancelled");
    expect(actionTarget("cancel", inv("unpaid"))).toBe("cancelled");
    expect(actionTarget("cancel", inv("partial", 10))).toBeNull();
    expect(actionTarget("cancel", inv("paid", 1000))).toBeNull();
    expect(actionTarget("reopen", inv("cancelled"))).toBe("draft");
    expect(actionTarget("reopen", inv("paid"))).toBeNull();
    expect(actionTarget("unissue", inv("unpaid"))).toBe("draft");
    expect(actionTarget("unissue", inv("partial", 10))).toBeNull();
    expect(availableActions(inv("draft"))).toEqual(["issue", "cancel"]);
    expect(availableActions(inv("paid", 1000))).toEqual([]);
  });
  it("guards payments and edits by status", () => {
    expect(canRecordPayment("unpaid")).toBe(true);
    expect(canRecordPayment("partial")).toBe(true);
    expect(canRecordPayment("draft")).toBe(false);
    expect(canRecordPayment("paid")).toBe(false);
    expect(canEditInvoice("partial")).toBe(true);
    expect(canEditInvoice("paid")).toBe(false);
    expect(canEditInvoice("cancelled")).toBe(false);
  });
});

describe("overdue", () => {
  it("is computed for open invoices past their due date only", () => {
    const today = "2026-10-30";
    expect(isOverdue({ status: "unpaid", due_date: "2026-10-29" }, today)).toBe(true);
    expect(isOverdue({ status: "partial", due_date: "2026-10-01" }, today)).toBe(true);
    expect(isOverdue({ status: "unpaid", due_date: "2026-10-30" }, today)).toBe(false);
    expect(isOverdue({ status: "unpaid", due_date: null }, today)).toBe(false);
    for (const s of ["paid", "cancelled", "draft"] as const)
      expect(isOverdue({ status: s, due_date: "2020-01-01" }, today)).toBe(false);
    expect(displayStatus({ status: "unpaid", due_date: "2026-10-01" }, today)).toBe("overdue");
    expect(displayStatus({ status: "paid", due_date: "2026-10-01" }, today)).toBe("paid");
  });
});

describe("numbering", () => {
  it("formats and parses <PREFIX>-YYYYMM-####", () => {
    expect(formatInvoiceNumber("inv", "2026-10-30", 7)).toBe("INV-202610-0007");
    expect(formatInvoiceNumber("ACME", "2026-01-02", 12345)).toBe("ACME-202601-12345");
    expect(parseInvoiceNumber("INV-202610-0007")).toEqual({
      prefix: "INV",
      period: "202610",
      seq: 7,
    });
    expect(parseInvoiceNumber("INV-2026-7")).toBeNull();
    expect(parseInvoiceNumber(null)).toBeNull();
  });
  it("normalizes the prefix and falls back to INV", () => {
    expect(normalizePrefix(" abc ")).toBe("ABC");
    expect(normalizePrefix("")).toBe("INV");
    expect(normalizePrefix("A-B")).toBe("INV");
    expect(normalizePrefix("TOOLONGPREFIX")).toBe("INV");
  });
  it("continues after the highest sequence of the same prefix and month", () => {
    const existing = [
      "INV-202610-0001",
      "INV-202610-0009",
      "INV-202609-0050",
      "ACME-202610-0100",
      "garbage",
      null,
    ];
    expect(nextInvoiceNumber("INV", "2026-10-30", existing)).toBe("INV-202610-0010");
    expect(nextInvoiceNumber("INV", "2026-11-01", existing)).toBe("INV-202611-0001");
    expect(nextInvoiceNumber("ACME", "2026-10-01", existing)).toBe("ACME-202610-0101");
  });
});

describe("validation", () => {
  const ok: InvoiceDraft = {
    customer_name: "PT Contoh",
    customer_email: "a@b.co",
    account_id: A,
    issue_date: "2026-10-01",
    due_date: "2026-10-15",
    items: [{ description: "Jasa desain", qty: 1, unit_price: 500_000 }],
  };
  it("accepts a valid invoice", () => {
    expect(validateInvoice(ok)).toEqual([]);
  });
  it("reports every problem as an i18n key", () => {
    expect(
      validateInvoice({
        ...ok,
        customer_name: " ",
        customer_email: "nope",
        account_id: null,
        due_date: "2026-09-01",
        items: [],
      }),
    ).toEqual([
      "Nama pelanggan wajib diisi",
      "Email pelanggan tidak valid",
      "Pilih dompet penerima",
      "Jatuh tempo tidak boleh sebelum tanggal terbit",
      "Tambahkan minimal satu item",
    ]);
    expect(
      validateInvoice({ ...ok, items: [{ description: "", qty: 0, unit_price: -1 }] }),
    ).toEqual([
      "Deskripsi item wajib diisi",
      "Qty harus lebih dari 0",
      "Harga satuan tidak boleh negatif",
      "Total invoice harus lebih dari 0",
    ]);
  });
  it("turns form rows into items, dropping blank rows", () => {
    expect(
      itemsFromRows([
        { description: " A ", qty: "2", unit_price: "1000" },
        { description: "", qty: 1, unit_price: "" },
        { description: "B", qty: "", unit_price: "5" },
      ]),
    ).toEqual([
      { description: "A", qty: 2, unit_price: 1000 },
      { description: "B", qty: NaN, unit_price: 5 },
    ]);
  });
  it("blocks edits that would undercut payments or move booked money", () => {
    expect(editProblem({ status: "paid", paid: 10, account_id: A }, { total: 10 })).toBe(
      "Invoice lunas atau dibatalkan tidak bisa diubah",
    );
    expect(
      editProblem({ status: "partial", paid: 500, account_id: A }, { total: 400, account_id: A }),
    ).toBe("Total tidak boleh lebih kecil dari yang sudah dibayar");
    expect(
      editProblem(
        { status: "partial", paid: 500, account_id: A },
        { total: 900, account_id: null },
      ),
    ).toBe("Dompet tidak bisa diganti setelah ada pembayaran");
    expect(
      editProblem({ status: "unpaid", paid: 0, account_id: A }, { total: 1, account_id: null }),
    ).toBeNull();
  });
  it("never lets a payment exceed the remaining amount", () => {
    const inv = { status: "partial" as const, total: 1000, paid: 400 };
    expect(paymentProblem(inv, 600)).toBeNull();
    expect(paymentProblem(inv, 600.01)).toBe("Pembayaran melebihi sisa tagihan");
    expect(paymentProblem(inv, 0)).toBe("Jumlah harus lebih dari 0");
    expect(paymentProblem({ ...inv, status: "draft" }, 10)).toBe(
      "Invoice ini tidak bisa menerima pembayaran",
    );
  });
  it("uses a stable idempotency key per payment", () => {
    expect(paymentExternalId("abc")).toBe("invoice_pay:abc");
  });
});

describe("list search & summary", () => {
  it("keeps only a valid account and status", () => {
    expect(validateInvoiceSearch({ account: A.toUpperCase(), status: "overdue" })).toEqual({
      account: A,
      status: "overdue",
    });
    expect(validateInvoiceSearch({ account: "x", status: "late" })).toEqual({});
  });
  it("sums outstanding and overdue amounts of open invoices", () => {
    expect(
      invoiceSummary(
        [
          { status: "unpaid", total: 1000, paid: 0, due_date: "2026-10-01" },
          { status: "partial", total: 1000, paid: 250, due_date: "2026-11-01" },
          { status: "paid", total: 500, paid: 500, due_date: "2026-01-01" },
          { status: "draft", total: 900, paid: 0, due_date: "2026-01-01" },
        ],
        "2026-10-30",
      ),
    ).toEqual({ outstanding: 1750, open: 2, overdue: 1, overdueAmount: 1000 });
  });
});

describe("module wiring", () => {
  it("registers activity labels", () => {
    expect(activityLabel("invoices.create")).toBe("Invoice ditambahkan");
    expect(activityLabel("invoice_payments.delete")).toBe("Pembayaran invoice dihapus");
  });
  it("restores invoices after accounts/transactions and children after invoices", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    expect(i("invoices")).toBeGreaterThan(i("accounts"));
    expect(i("invoices")).toBeGreaterThan(i("transactions"));
    expect(i("invoice_items")).toBeGreaterThan(i("invoices"));
    expect(i("invoice_payments")).toBeGreaterThan(i("invoices"));
    expect(CONFLICT_KEYS.invoices).toEqual(["id"]);
    expect(FK_COLUMNS["invoice_id"]).toBe("invoices");
  });
  it("is an admin module members cannot open by default", () => {
    expect((ADMIN_MODULES as readonly string[]).includes("invoices")).toBe(true);
    expect(canOpenPath("member", "/invoices")).toBe(false);
    expect(canOpenPath("admin", "/invoices")).toBe(true);
  });
});

describe("invoice prefix setting (v21 app_settings.invoice_prefix)", () => {
  it("defaults to INV when unset, invalid or the column is missing", () => {
    expect(resolveSettings(null, {}).invoice_prefix).toBe("INV");
    expect(resolveSettings({ invoice_prefix: "acme" } as never, {}).invoice_prefix).toBe("ACME");
    expect(resolveSettings({ invoice_prefix: "a b" } as never, {}).invoice_prefix).toBe("INV");
  });
  it("is optional in the settings form and validated when present", () => {
    const base = {
      app_name: null,
      tagline: null,
      logo_data: null,
      timezone: null,
      base_currency: "IDR",
      landing_enabled: true,
      landing_tagline: null,
      github_url: null,
      bot_default_account_id: null,
      reminder_days: null,
    };
    expect(appSettingsInputSchema.parse(base).invoice_prefix).toBeUndefined();
    expect(
      appSettingsInputSchema.parse({ ...base, invoice_prefix: " shop1 " }).invoice_prefix,
    ).toBe("SHOP1");
    expect(appSettingsInputSchema.parse({ ...base, invoice_prefix: "" }).invoice_prefix).toBeNull();
    expect(() => appSettingsInputSchema.parse({ ...base, invoice_prefix: "IN-V" })).toThrow();
  });
});
