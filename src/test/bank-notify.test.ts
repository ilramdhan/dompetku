import { describe, expect, it } from "vitest";
import {
  DEFAULT_AMOUNT_REGEX,
  GENERIC_FORMAT,
  MAX_SCAN_CHARS,
  NOTIFY_PRESETS,
  PARSE_REASON,
  SIGNAL_MAX_AGE_MS,
  appMatches,
  cleanLine,
  compileRegex,
  confirmProblem,
  extractAmount,
  formatProblems,
  formatValues,
  isFresh,
  isUniqueCode,
  keywords,
  matchSignal,
  minimiseText,
  normalizeNotification,
  parseNotification,
  parseRupiah,
  pickUniqueCode,
  postedAt,
  regexProblem,
  scanText,
  splitSignalAmount,
  transferAmount,
  type NotifyFormat,
} from "@/lib/bank-notify";
import { NOTIFY_RATE_RULES } from "@/lib/rate-limit";
import { validateIntegration, INTEGRATION_KEYS, integrationDef } from "@/lib/integrations";
import { RESTORE_TABLES, EPHEMERAL_COLUMNS, stripSecrets } from "@/lib/backup";
import { SERVER_FN_ACCESS } from "@/lib/server-fn-access";
import { activityLabel } from "@/lib/activity";
import { buildInvoiceEmail } from "@/lib/email";

describe("parseRupiah", () => {
  it.each([
    ["Rp 1.250.000,00", 1250000],
    ["Rp1.250.000", 1250000],
    ["Rp. 25.000", 25000],
    ["IDR1,250,000.00", 1250000],
    ["IDR 1,250,000", 1250000],
    ["1.250.000", 1250000],
    ["1,250,000", 1250000],
    ["1250000", 1250000],
    ["Rp 50.000,-", 50000],
    ["Rp 150.123,45", 150123.45],
    ["12,50", 12.5],
    ["12.5", 12.5],
    ["Rp 1.000", 1000],
    ["999", 999],
    ["1.250.000.", 1250000],
    ["+Rp 10.000", null],
    ["Rp\u00a01.250.000", 1250000],
  ])("%s → %s", (raw, want) => {
    expect(parseRupiah(raw)).toBe(want);
  });

  it.each(["", "abc", "Rp", "0", "1.2.3", "1.25.000", "1,250.000,00,1", "-5000", "12.345.67"])(
    "rejects %s",
    (raw) => {
      expect(parseRupiah(raw)).toBeNull();
    },
  );

  it("caps absurd values and non-strings", () => {
    expect(parseRupiah("9".repeat(30))).toBeNull();
    expect(parseRupiah(null)).toBeNull();
    expect(parseRupiah(1500)).toBe(1500);
  });
});

describe("regex safety", () => {
  it("accepts the default and simple patterns", () => {
    expect(regexProblem(DEFAULT_AMOUNT_REGEX)).toBeNull();
    expect(regexProblem(String.raw`sebesar Rp\s?([\d.,]+)`)).toBeNull();
    expect(regexProblem("(?:a|b)c")).toBeNull();
    expect(regexProblem("x(?:ab)?y")).toBeNull();
    expect(regexProblem("a+?b")).toBeNull();
  });

  it("rejects invalid, long and dangerous patterns", () => {
    expect(regexProblem("")).toBe("Regex tidak boleh kosong");
    expect(regexProblem("(")).toBe("Regex tidak valid");
    expect(regexProblem("a".repeat(201))).toMatch(/terlalu panjang/);
    for (const bad of ["(a+)+$", "(a*)*b", "(a|aa)+", "(?:x+y)*", "(a|b){2,}", "((ab)+)+"])
      expect(regexProblem(bad), bad).toMatch(/berisiko lambat/);
    expect(regexProblem(String.raw`(a)\1`)).toMatch(/backreference/);
    expect(regexProblem("(?<=Rp)\\d+")).toMatch(/lookbehind/);
    expect(regexProblem("a+b+c+d+e+")).toMatch(/terlalu banyak/);
  });

  it("does not treat escaped or class characters as quantifiers", () => {
    expect(regexProblem(String.raw`(\+62)\d+`)).toBeNull();
    expect(regexProblem("([+*])x")).toBeNull();
  });

  it("compileRegex returns null for unsafe patterns and is case-insensitive", () => {
    expect(compileRegex("(a+)+")).toBeNull();
    expect(compileRegex("masuk")!.test("DANA MASUK")).toBe(true);
  });

  it("runs only on truncated text", () => {
    const long = `${"x".repeat(MAX_SCAN_CHARS)} Rp 10.000`;
    expect(extractAmount(DEFAULT_AMOUNT_REGEX, long)).toBeNull();
    expect(scanText({ title: "t", text: "y".repeat(5000) }).length).toBe(MAX_SCAN_CHARS);
  });
});

describe("extractAmount", () => {
  it("uses the named group, then the first group, then the whole match", () => {
    expect(extractAmount(String.raw`total (?<amount>[\d.]+) ok`, "total 15.000 ok")).toBe(15000);
    expect(extractAmount(String.raw`sebesar ([\d.,]+)`, "Dana sebesar 1.000.123,00")).toBe(1000123);
    expect(extractAmount(String.raw`\d[\d.]*`, "IDR 7.500")).toBe(7500);
    expect(extractAmount(DEFAULT_AMOUNT_REGEX, "no amount here")).toBeNull();
  });
});

const fmt = (o: Partial<NotifyFormat>): NotifyFormat => ({
  ...GENERIC_FORMAT,
  name: "X",
  ...o,
});
const note = (title: string, text: string, pkg = "com.bca", app = "BCA mobile") => ({
  app,
  package: pkg,
  title,
  text,
});

describe("parseNotification", () => {
  const bca = fmt({ name: "BCA", app_match: "com.bca" });

  it("matches the app and reads an incoming amount", () => {
    const r = parseNotification([bca], note("Dana Masuk", "Rp 150.123,00 dari BUDI"));
    expect(r).toMatchObject({ kind: "amount", amount: 150123, generic: false });
    if (r.kind === "amount") expect(r.format.name).toBe("BCA");
  });

  it("ignores outgoing money, OTPs and texts without an incoming keyword", () => {
    expect(parseNotification([bca], note("Transfer", "Dana keluar Rp 10.000")).kind).toBe(
      "ignored",
    );
    expect(parseNotification([bca], note("OTP", "Kode OTP 123456 dana masuk")).kind).toBe(
      "ignored",
    );
    const r = parseNotification([bca], note("Info", "Saldo Rp 10.000"));
    expect(r).toMatchObject({ kind: "ignored", reason: PARSE_REASON.noKeyword });
  });

  it("falls back to the generic format only when enabled", () => {
    const n = note("Dana masuk", "Rp 20.000", "id.other", "Other");
    expect(parseNotification([bca], n)).toEqual({ kind: "none", reason: PARSE_REASON.noFormat });
    expect(parseNotification([bca], n, { generic: true })).toMatchObject({
      kind: "amount",
      amount: 20000,
      generic: true,
    });
  });

  it("skips disabled formats and honours title/text filters (contains + regex)", () => {
    const off = { ...bca, enabled: false };
    expect(parseNotification([off], note("Dana masuk", "Rp 1.000")).kind).toBe("none");
    const titled = fmt({ app_match: null, title_match: "mutasi", must_contain: null });
    expect(parseNotification([titled], note("Info", "Rp 1.000")).kind).toBe("none");
    expect(parseNotification([titled], note("Mutasi Rekening", "CR Rp 1.000")).kind).toBe("amount");
    const rx = fmt({
      app_match: null,
      match_mode: "regex",
      text_match: "^CR\\b",
      must_contain: null,
    });
    expect(parseNotification([rx], note("x", "CR Rp 5.000")).kind).toBe("amount");
    expect(parseNotification([rx], note("x", "DB Rp 5.000")).kind).toBe("none");
  });

  it("reports a missing amount", () => {
    expect(parseNotification([bca], note("Dana masuk", "cek aplikasi"))).toMatchObject({
      kind: "ignored",
      reason: PARSE_REASON.noAmount,
    });
  });

  it("presets are editable examples with valid patterns", () => {
    expect(NOTIFY_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const p of NOTIFY_PRESETS) {
      expect(p.name).toMatch(/contoh, sesuaikan/);
      expect(formatProblems(p)).toEqual([]);
    }
    const dana = NOTIFY_PRESETS.find((p) => p.key === "dana")!;
    expect(
      parseNotification(
        [dana],
        note("DANA", "Kamu menerima Rp50.123 dari Budi", "id.dana", "DANA"),
      ),
    ).toMatchObject({ kind: "amount", amount: 50123 });
  });

  it("appMatches checks package and app name", () => {
    expect(appMatches({ app_match: "bca" }, note("", "", "x.y", "BCA mobile"))).toBe(true);
    expect(appMatches({ app_match: "dana, ovo" }, note("", "", "ovo.id", "OVO"))).toBe(true);
    expect(appMatches({ app_match: "dana" }, note("", "", "ovo.id", "OVO"))).toBe(false);
    expect(appMatches({ app_match: null }, note("", ""))).toBe(true);
  });
});

describe("formats", () => {
  it("validates and normalises", () => {
    expect(formatProblems({ name: "", amount_regex: "(" })).toEqual([
      "Nama format wajib diisi",
      "Regex tidak valid",
    ]);
    expect(
      formatProblems({ name: "A", amount_regex: "x", match_mode: "regex", title_match: "(a+)+" }),
    ).toEqual(["Regex berisiko lambat (quantifier bersarang), sederhanakan polanya"]);
    const v = formatValues(fmt({ name: " A ", app_match: "  ", must_contain: " masuk " }));
    expect(v).toMatchObject({ name: "A", app_match: null, must_contain: "masuk", enabled: true });
    expect(keywords(" A, ,b ")).toEqual(["a", "b"]);
  });
});

describe("notification normalisation & minimisation", () => {
  it("cleans lines, drops unresolved magic text and prefers the big text", () => {
    expect(cleanLine("a\nb\t c", 10)).toBe("a b c");
    expect(cleanLine("{not_text_big}", 10)).toBe("");
    const n = normalizeNotification({
      app: "BCA",
      package: "COM.BCA",
      title: "Dana masuk",
      text: "Rp 10.000",
      big_text: "Rp 10.000 dari BUDI ke rek 1234567890",
      sub_text: "{not_sub_text}",
    });
    expect(n).toEqual({
      app: "BCA",
      package: "com.bca",
      title: "Dana masuk",
      text: "Rp 10.000 dari BUDI ke rek 1234567890",
    });
  });

  it("masks long digit runs and caps the excerpt", () => {
    const m = minimiseText({ title: "Masuk", text: "Rp 1.250.000 ref 9876543210 rek 1234567" });
    expect(m).toContain("Rp 1.250.000");
    expect(m).not.toContain("9876543210");
    expect(m).toContain("••••••210");
    expect(m).toContain("••••567");
    expect(minimiseText({ title: "", text: "x".repeat(1000) }).length).toBe(300);
  });

  it("reads timestamps and checks freshness", () => {
    expect(postedAt("1761900000000")).toBe(1761900000000);
    expect(postedAt("1761900000")).toBe(1761900000000);
    expect(postedAt("2026-11-01T10:00:00Z")).toBe(Date.parse("2026-11-01T10:00:00Z"));
    expect(postedAt("{not_timestamp}")).toBeNull();
    expect(postedAt("")).toBeNull();
    const now = Date.parse("2026-11-01T10:00:00Z");
    expect(isFresh(now - 1000, now)).toBe(true);
    expect(isFresh(now - SIGNAL_MAX_AGE_MS - 1, now)).toBe(false);
    expect(isFresh(now + 3_600_000, now)).toBe(false);
  });
});

describe("unique codes & matching", () => {
  it("picks a free code in 1..999", () => {
    expect(pickUniqueCode([], () => 0)).toBe(1);
    expect(pickUniqueCode([1, 2], () => 0)).toBe(3);
    expect(pickUniqueCode([999], () => 0.999999)).toBe(1);
    const all = Array.from({ length: 999 }, (_, i) => i + 1);
    expect(pickUniqueCode(all)).toBeNull();
    expect(pickUniqueCode(all.slice(0, 998))).toBe(999);
    expect(isUniqueCode(0)).toBe(false);
    expect(isUniqueCode(1000)).toBe(false);
    expect(isUniqueCode(5)).toBe(true);
  });

  it("transfer amount = remaining + code while due", () => {
    expect(transferAmount(150000, 123)).toBe(150123);
    expect(transferAmount(150000, null)).toBe(150000);
    expect(transferAmount(0, 123)).toBe(0);
  });

  const now = Date.parse("2026-11-01T10:00:00Z");
  const inv = (
    id: string,
    total: number,
    code: number | null,
    extra: Partial<{ paid: number; created_at: string; account_id: string }> = {},
  ) => ({
    id,
    total,
    paid: extra.paid ?? 0,
    unique_code: code,
    created_at: extra.created_at ?? "2026-10-31T00:00:00Z",
    account_id: extra.account_id ?? "acc1",
  });

  it("matches exactly one, flags ambiguous, ignores later invoices and other wallets", () => {
    const list = [
      inv("a", 150000, 123),
      inv("b", 150000, 456),
      inv("c", 200000, null, { paid: 50000 }),
    ];
    expect(matchSignal(150123, list, { postedAt: now })).toEqual({
      status: "matched",
      invoiceId: "a",
    });
    expect(matchSignal(150000, list, { postedAt: now })).toEqual({
      status: "matched",
      invoiceId: "c",
    });
    expect(matchSignal(150124, list, { postedAt: now })).toEqual({ status: "unmatched" });
    const dupes = [inv("x", 100000, null), inv("y", 100000, null)];
    expect(matchSignal(100000, dupes, { postedAt: now })).toEqual({
      status: "ambiguous",
      invoiceIds: ["x", "y"],
    });
    const later = [inv("z", 1000, 1, { created_at: "2026-11-02T00:00:00Z" })];
    expect(matchSignal(1001, later, { postedAt: now })).toEqual({ status: "unmatched" });
    expect(matchSignal(150123, list, { postedAt: now, accountId: "other" })).toEqual({
      status: "unmatched",
    });
    expect(matchSignal(1, [inv("p", 1000, 1, { paid: 1000 })], { postedAt: now })).toEqual({
      status: "unmatched",
    });
  });

  it("splits the code into an extra income only on an exact match", () => {
    expect(splitSignalAmount(150123, 150000, 123)).toEqual({ pay: 150000, extra: 123 });
    expect(splitSignalAmount(150000, 150000, 123)).toEqual({ pay: 150000, extra: 0 });
    expect(splitSignalAmount(90000, 150000, 123)).toEqual({ pay: 90000, extra: 0 });
    expect(splitSignalAmount(200000, 150000, null)).toEqual({ pay: 150000, extra: 0 });
  });

  it("confirmProblem guards status, invoice and amount", () => {
    const open = { status: "matched", payment_id: null };
    const i = { status: "unpaid", total: 1000, paid: 0 };
    expect(confirmProblem(open, i, 1000)).toBeNull();
    expect(confirmProblem({ status: "confirmed" }, i, 1000)).toBe("Notifikasi ini sudah diproses");
    expect(confirmProblem({ status: "matched", payment_id: "p" }, i, 1000)).toBe(
      "Notifikasi ini sudah diproses",
    );
    expect(confirmProblem(open, { ...i, status: "paid" }, 1000)).toBe(
      "Invoice ini tidak bisa menerima pembayaran",
    );
    expect(confirmProblem(open, i, 1001)).toBe("Pembayaran melebihi sisa tagihan");
    expect(confirmProblem(open, i, 0)).toBe("Jumlah harus lebih dari 0");
  });
});

describe("v26 wiring", () => {
  it("integration keys: token is a validated secret, toggles default false", () => {
    expect(INTEGRATION_KEYS).toEqual(
      expect.arrayContaining(["MACRODROID_TOKEN", "MACRODROID_AUTO_CONFIRM", "MACRODROID_GENERIC"]),
    );
    expect(integrationDef("MACRODROID_TOKEN").secret).toBe(true);
    expect(validateIntegration("MACRODROID_TOKEN", "short").ok).toBe(false);
    expect(validateIntegration("MACRODROID_TOKEN", "a".repeat(32)).ok).toBe(true);
    expect(validateIntegration("MACRODROID_TOKEN", `${"a".repeat(31)} `).ok).toBe(false);
    expect(validateIntegration("MACRODROID_AUTO_CONFIRM", "TRUE")).toEqual({
      ok: true,
      value: "true",
    });
    expect(integrationDef("MACRODROID_AUTO_CONFIRM").default).toBe("false");
    expect(integrationDef("MACRODROID_GENERIC").default).toBe("false");
  });

  it("rate limits exist for valid devices and bad tokens", () => {
    expect(NOTIFY_RATE_RULES.device.length).toBeGreaterThan(0);
    expect(NOTIFY_RATE_RULES.bad[0]!.name).toBe("notify:bad");
  });

  it("backs up formats, never signals, and strips unique codes", () => {
    expect(RESTORE_TABLES).toContain("payment_notify_formats");
    expect((RESTORE_TABLES as readonly string[]).includes("payment_signals")).toBe(false);
    expect(EPHEMERAL_COLUMNS.invoices).toEqual(["unique_code"]);
    expect(stripSecrets("invoices", [{ id: "1", unique_code: 5 }])).toEqual([{ id: "1" }]);
  });

  it("classifies the new server fns as admin and labels activities", () => {
    const c = SERVER_FN_ACCESS["payment-signals.functions.ts"]!;
    expect(Object.values(c).every((v) => v === "admin")).toBe(true);
    expect(activityLabel("payment_signals.confirm")).toBe("Notifikasi bank dikonfirmasi");
    expect(activityLabel("payment_notify_formats.create")).toBe("Format notifikasi ditambahkan");
  });

  it("invoice email shows the transfer amount with the unique code while open", () => {
    const base = {
      kind: "invoice" as const,
      number: "INV-1",
      customer_name: "Budi",
      due_date: null,
      total: 150000,
      paid: 0,
      remaining: 150000,
      today: "2026-11-01",
    };
    const m = buildInvoiceEmail({ ...base, unique_code: 123 });
    expect(m.text).toContain("Jumlah transfer");
    expect(m.text).toMatch(/150\.123/);
    expect(m.text).toContain("kode unik 123");
    expect(m.html).toContain("kode unik 123");
    const en = buildInvoiceEmail({ ...base, lang: "en", unique_code: 123 });
    expect(en.text).toContain("Amount to transfer");
    expect(buildInvoiceEmail(base).text).not.toContain("Jumlah transfer");
    expect(buildInvoiceEmail({ ...base, unique_code: 0 }).text).not.toContain("Jumlah transfer");
    const paid = buildInvoiceEmail({
      ...base,
      kind: "payment",
      unique_code: 123,
      payment_amount: 1,
    });
    expect(paid.text).not.toContain("kode unik");
  });
});
