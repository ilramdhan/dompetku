import { describe, expect, it } from "vitest";
import {
  DEMO_SHARE_MAX_DAYS,
  PUBLIC_INVOICE_KEYS,
  PUBLIC_ITEM_KEYS,
  PUBLIC_PAYMENT_KEYS,
  SHARE_TOKEN_BYTES,
  isPublicStatus,
  normalizeShareToken,
  normalizeWaPhone,
  shareExpiresAt,
  shareState,
  shareUrl,
  toBase64Url,
  toPublicInvoice,
  waShareUrl,
} from "@/lib/invoice-share";
import { hashShareToken, newShareToken } from "@/lib/invoice-share.server";
import { RESTORE_TABLES } from "@/lib/backup";
import { SERVER_FN_ACCESS } from "@/lib/server-fn-access";
import { isLangPath, urlLangFor } from "@/lib/lang";
import { PUBLIC_PATHS, sitemapXml } from "@/lib/seo";
import { activityLabel } from "@/lib/activity";

const TOKEN = "A".repeat(43);

describe("share token", () => {
  it("generates 256-bit base64url tokens that pass the format check", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a).not.toBe(b);
    expect(normalizeShareToken(a)).toBe(a);
    expect(a).toHaveLength(Math.ceil((SHARE_TOKEN_BYTES * 8) / 6));
    expect(SHARE_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
  });
  it("rejects anything that is not exactly a token", () => {
    expect(normalizeShareToken(` ${TOKEN} `)).toBe(TOKEN);
    expect(normalizeShareToken(TOKEN.slice(1))).toBeNull();
    expect(normalizeShareToken(`${TOKEN}A`)).toBeNull();
    expect(normalizeShareToken("A".repeat(42) + "=")).toBeNull();
    expect(normalizeShareToken("A".repeat(42) + "/")).toBeNull();
    expect(normalizeShareToken(null)).toBeNull();
    expect(normalizeShareToken(42)).toBeNull();
  });
  it("hashes to lower-case SHA-256 hex (what the schema check expects)", () => {
    const h = hashShareToken(TOKEN);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(TOKEN)).toBe(h);
    expect(hashShareToken("B".repeat(43))).not.toBe(h);
  });
  it("encodes base64url without padding", () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(toBase64Url(new Uint8Array([1]))).toBe("AQ");
  });
});

describe("expiry and state", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  it("computes expiry, never on 0, capped on demo", () => {
    expect(shareExpiresAt(0, now)).toBeNull();
    expect(shareExpiresAt(null, now)).toBeNull();
    expect(shareExpiresAt(7, now)).toBe("2026-11-06T00:00:00.000Z");
    expect(shareExpiresAt(0, now, true)).toBe(
      new Date(now.getTime() + DEMO_SHARE_MAX_DAYS * 86_400_000).toISOString(),
    );
    expect(shareExpiresAt(90, now, true)).toBe(shareExpiresAt(DEMO_SHARE_MAX_DAYS, now));
  });
  it("derives none/active/expired/revoked", () => {
    const base = { created_at: "2026-10-01T00:00:00Z", expires_at: null, revoked_at: null };
    expect(shareState(null, now)).toBe("none");
    expect(shareState(base, now)).toBe("active");
    expect(shareState({ ...base, expires_at: "2026-10-31T00:00:00Z" }, now)).toBe("active");
    expect(shareState({ ...base, expires_at: "2026-10-30T00:00:00Z" }, now)).toBe("expired");
    expect(shareState({ ...base, revoked_at: "2026-10-02T00:00:00Z" }, now)).toBe("revoked");
  });
  it("only issued invoices are public", () => {
    expect(["unpaid", "partial", "paid"].every(isPublicStatus)).toBe(true);
    expect(isPublicStatus("draft")).toBe(false);
    expect(isPublicStatus("cancelled")).toBe(false);
  });
});

describe("links", () => {
  it("builds the absolute link from the site URL or origin", () => {
    expect(shareUrl("https://dompet.example.com/", TOKEN)).toBe(
      `https://dompet.example.com/i/${TOKEN}`,
    );
  });
  it("normalises Indonesian phone numbers for wa.me", () => {
    expect(normalizeWaPhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizeWaPhone("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizeWaPhone("812 3456 7890")).toBe("6281234567890");
    expect(normalizeWaPhone("(021) 555-1234")).toBe("62215551234");
    expect(normalizeWaPhone("0065 9123 4567")).toBe("6591234567");
    expect(normalizeWaPhone("+1 415 555 0100")).toBe("14155550100");
    expect(normalizeWaPhone("abc")).toBeNull();
    expect(normalizeWaPhone("123")).toBeNull();
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
  });
  it("builds wa.me share URLs with and without a phone", () => {
    expect(waShareUrl("Halo & link", "08123456789")).toBe(
      "https://wa.me/628123456789?text=Halo%20%26%20link",
    );
    expect(waShareUrl("x", "nope")).toBe("https://wa.me/?text=x");
    expect(waShareUrl("x")).toBe("https://wa.me/?text=x");
  });
});

describe("toPublicInvoice", () => {
  const inv = {
    id: "11111111-1111-4111-8111-111111111111",
    number: "INV-202610-0001",
    customer_name: "PT Pelanggan",
    customer_email: "a@b.co",
    customer_phone: "0812",
    account_id: "22222222-2222-4222-8222-222222222222",
    issue_date: "2026-10-01",
    due_date: "2026-10-15",
    notes: "private note",
    status: "partial" as const,
    currency: "IDR",
    total: "300000",
    paid: "100000",
    created_at: "x",
    updated_at: "x",
  };
  const items = [
    { id: "i2", invoice_id: inv.id, description: "B", qty: "1", unit_price: "100000", position: 1 },
    { id: "i1", invoice_id: inv.id, description: "A", qty: 2, unit_price: 100000, position: 0 },
  ];
  const pays = [
    {
      id: "p1",
      invoice_id: inv.id,
      amount: "100000",
      paid_at: "2026-10-05",
      method: "transfer",
      reference: "REF-123",
      note: "n",
      transaction_id: "33333333-3333-4333-8333-333333333333",
    },
  ];

  it("returns only whitelisted keys (no wallet, notes, ids, references)", () => {
    const p = toPublicInvoice(inv, items, pays, "2026-10-10")!;
    expect(Object.keys(p).sort()).toEqual([...PUBLIC_INVOICE_KEYS].sort());
    for (const i of p.items) expect(Object.keys(i).sort()).toEqual([...PUBLIC_ITEM_KEYS].sort());
    for (const x of p.payments)
      expect(Object.keys(x).sort()).toEqual([...PUBLIC_PAYMENT_KEYS].sort());
    const json = JSON.stringify(p);
    for (const secret of [
      "account_id",
      "notes",
      "transaction_id",
      "reference",
      "REF-123",
      "private note",
      "a@b.co",
      "customer_email",
      "customer_phone",
      "method",
      "invoice_id",
      inv.id,
      inv.account_id,
      pays[0]!.transaction_id,
      '"id"',
    ])
      expect(json).not.toContain(secret);
  });
  it("computes amounts, order and overdue", () => {
    const p = toPublicInvoice(inv, items, pays, "2026-10-10")!;
    expect(p.items.map((i) => i.description)).toEqual(["A", "B"]);
    expect(p.items[0]!.amount).toBe(200000);
    expect(p.total).toBe(300000);
    expect(p.paid).toBe(100000);
    expect(p.remaining).toBe(200000);
    expect(p.status).toBe("partial");
    expect(p.payments).toEqual([{ paid_at: "2026-10-05", amount: 100000 }]);
    expect(toPublicInvoice(inv, items, pays, "2026-10-20")!.status).toBe("overdue");
  });
  it("never exposes draft or cancelled invoices", () => {
    expect(toPublicInvoice({ ...inv, status: "draft" }, items, [], "2026-10-10")).toBeNull();
    expect(toPublicInvoice({ ...inv, status: "cancelled" }, items, [], "2026-10-10")).toBeNull();
  });
});

describe("wiring", () => {
  it("does not back up token hashes", () => {
    expect((RESTORE_TABLES as readonly string[]).includes("invoice_shares")).toBe(false);
  });
  it("classifies the public fn as public and admin fns as admin", () => {
    expect(SERVER_FN_ACCESS["invoice-public.functions.ts"]).toEqual({
      getPublicInvoice: "public",
      submitInvoiceProof: "public",
    });
    const inv = SERVER_FN_ACCESS["invoices.functions.ts"]!;
    expect(inv["createInvoiceShareFn"]).toBe("admin");
    expect(inv["revokeInvoiceShareFn"]).toBe("admin");
    expect(inv["getInvoiceShareFn"]).toBe("admin");
  });
  it("honours ?lang= on invoice links but keeps them out of the sitemap", () => {
    expect(isLangPath(`/i/${TOKEN}`)).toBe(true);
    expect(isLangPath("/i/")).toBe(false);
    expect(urlLangFor(`/i/${TOKEN}`, { lang: "en" })).toBe("en");
    expect(PUBLIC_PATHS as readonly string[]).not.toContain("/i/");
    expect(sitemapXml("https://x.example")).not.toContain("/i/");
  });
  it("labels share activity", () => {
    expect(activityLabel("invoice_shares.create")).toBe("Tautan publik invoice dibuat");
    expect(activityLabel("invoice_shares.delete")).toBe("Tautan publik invoice dicabut");
  });
});
