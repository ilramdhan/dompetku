/**
 * Pure, client-safe rules for bank / e-wallet notifications forwarded by MacroDroid (v26, issue
 * #96). Shared by the endpoint (`payment-signals.server.ts`) and the Settings "Uji teks contoh" box,
 * so a format behaves exactly the same in the browser and on the server. Unit-tested in
 * src/test/bank-notify.test.ts.
 *
 * - Notification formats are admin-defined (table `payment_notify_formats`): which app (package /
 *   name substrings), optional title/text filter (contains or regex), an amount regex, and
 *   "must contain" / "ignore if contains" keyword lists. PRESETS are editable examples only.
 * - Admin regexes are untrusted-ish: `regexProblem()` caps length, requires them to compile and
 *   rejects shapes known for catastrophic backtracking (nested/alternating quantified groups,
 *   backreferences, lookbehind, many unbounded quantifiers). They only ever run on text truncated
 *   to MAX_SCAN_CHARS.
 * - `parseRupiah()` reads Indonesian and international amount spellings.
 * - `matchSignal()` finds the open invoice whose remaining amount + unique code equals the amount.
 */

/* ---------------- limits ---------------- */

export const NOTIFY_LIMITS = {
  name: 60,
  match: 200,
  regex: 200,
  keywords: 300,
  app: 120,
  title: 160,
  text: 1000,
  device: 60,
  excerpt: 300,
} as const;
/** Max formats per instance. */
export const MAX_FORMATS = 50;
/** Text a regex ever sees (title + text + big text, joined), keeps worst-case backtracking small. */
export const MAX_SCAN_CHARS = 600;
/** Max unbounded quantifiers (`*`, `+`, `{n,}`) in an admin regex. */
export const MAX_UNBOUNDED = 3;
/** Unique code range (rupiah added to the amount to transfer). */
export const UNIQUE_CODE_MIN = 1;
export const UNIQUE_CODE_MAX = 999;
/** A notification older/newer than this (vs. the server clock) is ignored as stale. */
export const SIGNAL_MAX_AGE_MS = 48 * 3_600_000;
export const SIGNAL_MAX_FUTURE_MS = 10 * 60_000;
/** Tolerance between the invoice creation time and the notification time. */
export const INVOICE_CLOCK_SKEW_MS = 10 * 60_000;
/** Largest amount accepted from a notification. */
export const MAX_SIGNAL_AMOUNT = 1e13;

const EPS = 0.005;

/* ---------------- amounts ---------------- */

/**
 * Indonesian/international amount text → number, or null.
 * "Rp 1.250.000,00" · "Rp1.250.000" · "IDR1,250,000.00" · "1.250.000" · "Rp 50.000,-" ·
 * "Rp. 25.000" · "1250000" · "12,50". A single separator followed by exactly three digits is a
 * thousands separator (rupiah rarely has cents); with 1–2 digits it is the decimal mark.
 */
export function parseRupiah(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let s = String(raw)
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/^(?:rp\.?|idr)\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/[,.]-+$/, "")
    .replace(/[,.]$/, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s) || s.length > 25) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const i = s.lastIndexOf(dec);
    intPart = s.slice(0, i);
    frac = s.slice(i + 1);
    if (!/^\d{1,2}$/.test(frac) || intPart.includes(dec)) return null;
    if (!groupsOk(intPart, thou)) return null;
    intPart = intPart.split(thou).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]!)) {
      intPart = parts[0]!;
      frac = parts[1]!;
    } else {
      if (!groupsOk(s, sep)) return null;
      intPart = parts.join("");
    }
  }
  if (!/^\d+$/.test(intPart)) return null;
  const n = Number(`${intPart}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SIGNAL_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

/** "1.250.000" with `.`: first group 1–3 digits, every other group exactly 3. */
function groupsOk(s: string, sep: string): boolean {
  const g = s.split(sep);
  if (!/^\d{1,3}$/.test(g[0]!)) return false;
  return g.slice(1).every((x) => /^\d{3}$/.test(x));
}

/* ---------------- regex safety ---------------- */

/**
 * Problem with an admin-supplied regex (Indonesian i18n key) or null. Compiles with the `i` flag
 * (the same flags `compileRegex` uses).
 */
export function regexProblem(src: string | null | undefined): string | null {
  const s = String(src ?? "");
  if (!s.trim()) return "Regex tidak boleh kosong";
  if (s.length > NOTIFY_LIMITS.regex) return "Regex terlalu panjang (maks. 200 karakter)";
  try {
    new RegExp(s, "i");
  } catch {
    return "Regex tidak valid";
  }
  if (/\\[1-9]|\\k</.test(s)) return "Regex tidak boleh memakai backreference";
  if (/\(\?<[=!]/.test(s)) return "Regex tidak boleh memakai lookbehind";
  const shape = quantifierShape(s);
  if (shape.nested) return "Regex berisiko lambat (quantifier bersarang), sederhanakan polanya";
  if (shape.unbounded > MAX_UNBOUNDED)
    return "Regex berisiko lambat (terlalu banyak * atau +), sederhanakan polanya";
  return null;
}

/**
 * Walks the pattern once: counts unbounded quantifiers and flags a quantified group that itself
 * contains an unbounded quantifier or an alternation — the classic `(a+)+` / `(a|a)*` shapes.
 */
function quantifierShape(s: string): { nested: boolean; unbounded: number } {
  type Frame = { unbounded: boolean; alt: boolean };
  const stack: Frame[] = [{ unbounded: false, alt: false }];
  let unbounded = 0;
  let nested = false;
  let inClass = false;
  let closed: Frame | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\") {
      i++;
      closed = null;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      closed = null;
      continue;
    }
    const isUnbounded =
      c === "*" || c === "+" || (c === "{" && /^\{\d+,\}/.test(s.slice(i, i + 12)));
    const isQuant = isUnbounded || c === "?" || (c === "{" && /^\{\d+(,\d*)?\}/.test(s.slice(i)));
    if (isQuant) {
      // `?` right after another quantifier is the lazy modifier, not a quantifier.
      const prev = s[i - 1];
      const lazy = c === "?" && (prev === "*" || prev === "+" || prev === "?" || prev === "}");
      if (!lazy) {
        if (isUnbounded) {
          unbounded++;
          stack[stack.length - 1]!.unbounded = true;
        }
        if (closed && (closed.unbounded || closed.alt) && (isUnbounded || c === "{")) nested = true;
      }
      if (c === "{") i = s.indexOf("}", i);
      closed = null;
      continue;
    }
    closed = null;
    if (c === "[") inClass = true;
    else if (c === "(") stack.push({ unbounded: false, alt: false });
    else if (c === "|") stack[stack.length - 1]!.alt = true;
    else if (c === ")" && stack.length > 1) {
      closed = stack.pop()!;
      if (closed.unbounded) stack[stack.length - 1]!.unbounded = true;
    }
  }
  return { nested, unbounded };
}

/** Compiled regex (flag `i`) or null when it fails `regexProblem`. */
export function compileRegex(src: string | null | undefined): RegExp | null {
  if (regexProblem(src)) return null;
  return new RegExp(String(src), "i");
}

/* ---------------- formats ---------------- */

export type MatchMode = "contains" | "regex";
export const MATCH_MODES: readonly MatchMode[] = ["contains", "regex"];

export type NotifyFormat = {
  id?: string;
  name: string;
  /** Comma-separated substrings of the app package or app name (any); empty = any app. */
  app_match: string | null;
  title_match: string | null;
  text_match: string | null;
  match_mode: MatchMode;
  amount_regex: string;
  /** Comma-separated keywords; at least one must appear (empty = no requirement). */
  must_contain: string | null;
  /** Comma-separated keywords; any of them → ignored (e.g. outgoing money, OTP). */
  ignore_contains: string | null;
  /** Optional wallet: only invoices paid into this wallet are candidates. */
  account_id?: string | null;
  enabled: boolean;
  position?: number;
};

/** Default amount pattern: "Rp 1.250.000,00", "IDR1,250,000", "Rp. 50.000". */
export const DEFAULT_AMOUNT_REGEX = String.raw`(?:Rp\.?|IDR)\s?(?<amount>\d[\d.,]*)`;
const INCOMING = "masuk,diterima,menerima,terima,kredit,received";
const OUTGOING = "keluar,debit,berhasil dibayar,pembayaran ke,transfer ke,kirim ke,top up,OTP,kode";

/**
 * Editable examples for common Indonesian apps (not verified against real notifications — the
 * admin must check them with "Uji teks contoh" and adjust). Package names are best effort.
 */
export const NOTIFY_PRESETS: readonly (NotifyFormat & { key: string })[] = [
  ["bca", "BCA (contoh, sesuaikan)", "com.bca,bca"],
  ["mandiri", "Livin' by Mandiri (contoh, sesuaikan)", "id.bmri,livin,mandiri"],
  ["bri", "BRImo (contoh, sesuaikan)", "id.co.bri,brimo"],
  ["bni", "BNI / wondr (contoh, sesuaikan)", "bni,wondr"],
  ["dana", "DANA (contoh, sesuaikan)", "id.dana"],
  ["ovo", "OVO (contoh, sesuaikan)", "ovo.id,ovo"],
  ["gopay", "GoPay (contoh, sesuaikan)", "gopay,com.gojek"],
  ["shopeepay", "ShopeePay (contoh, sesuaikan)", "com.shopee,shopeepay"],
].map(([key, name, app]) => ({
  key: key!,
  name: name!,
  app_match: app!,
  title_match: null,
  text_match: null,
  match_mode: "contains" as const,
  amount_regex: DEFAULT_AMOUNT_REGEX,
  must_contain: INCOMING,
  ignore_contains: OUTGOING,
  account_id: null,
  enabled: true,
}));

/** The generic fallback (any app, Rupiah amount + incoming keyword), used when enabled. */
export const GENERIC_FORMAT: NotifyFormat = {
  name: "Generik (Rupiah)",
  app_match: null,
  title_match: null,
  text_match: null,
  match_mode: "contains",
  amount_regex: DEFAULT_AMOUNT_REGEX,
  must_contain: INCOMING,
  ignore_contains: OUTGOING,
  account_id: null,
  enabled: true,
};

/** "a, b ,c" → ["a","b","c"] (lower-case, empty dropped, ≤ 20 items). */
export function keywords(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

/** Validation problems of a format (Indonesian i18n keys). */
export function formatProblems(f: Partial<NotifyFormat>): string[] {
  const out: string[] = [];
  const name = String(f.name ?? "").trim();
  if (!name) out.push("Nama format wajib diisi");
  else if (name.length > NOTIFY_LIMITS.name) out.push("Nama format terlalu panjang");
  for (const k of ["app_match", "title_match", "text_match"] as const)
    if (String(f[k] ?? "").length > NOTIFY_LIMITS.match)
      out.push("Teks pencocokan terlalu panjang");
  for (const k of ["must_contain", "ignore_contains"] as const)
    if (String(f[k] ?? "").length > NOTIFY_LIMITS.keywords)
      out.push("Daftar kata kunci terlalu panjang");
  if (f.match_mode && !MATCH_MODES.includes(f.match_mode)) out.push("Mode pencocokan tidak valid");
  if (f.match_mode === "regex")
    for (const k of ["title_match", "text_match"] as const) {
      const v = String(f[k] ?? "").trim();
      if (v) {
        const p = regexProblem(v);
        if (p) out.push(p);
      }
    }
  const p = regexProblem(f.amount_regex);
  if (p) out.push(p);
  return [...new Set(out)];
}

/** Trimmed DB values of a valid format (empty strings → null). */
export function formatValues(f: NotifyFormat) {
  const opt = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };
  return {
    name: f.name.trim(),
    app_match: opt(f.app_match),
    title_match: opt(f.title_match),
    text_match: opt(f.text_match),
    match_mode: f.match_mode === "regex" ? ("regex" as const) : ("contains" as const),
    amount_regex: f.amount_regex.trim(),
    must_contain: opt(f.must_contain),
    ignore_contains: opt(f.ignore_contains),
    account_id: f.account_id || null,
    enabled: f.enabled !== false,
  };
}

/* ---------------- notifications ---------------- */

export type NotificationInput = {
  app: string;
  package: string;
  title: string;
  text: string;
};

/** MacroDroid leaves unresolved magic text such as "{not_text_big}" literally; drop it. */
const unresolved = (s: string) => /^\{[a-z_=]+\}$|^\[[a-z_=]+\]$/i.test(s.trim());

/** One clean single-spaced line, control characters removed, cut to `max`. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = Array.from(String(v), (c) => {
    const n = c.charCodeAt(0);
    return n < 32 || n === 127 ? " " : c;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return unresolved(s) ? "" : s.slice(0, max);
}

/**
 * Normalises a raw endpoint body. `text` = big text when it is longer (it usually contains the
 * whole message), else the normal text (+ sub text).
 */
export function normalizeNotification(body: Record<string, unknown>): NotificationInput {
  const text = cleanLine(body["text"], NOTIFY_LIMITS.text);
  const big = cleanLine(body["big_text"], NOTIFY_LIMITS.text);
  const sub = cleanLine(body["sub_text"], NOTIFY_LIMITS.title);
  const main = big.length > text.length ? big : text;
  return {
    app: cleanLine(body["app"], NOTIFY_LIMITS.app),
    package: cleanLine(body["package"], NOTIFY_LIMITS.app).toLowerCase(),
    title: cleanLine(body["title"], NOTIFY_LIMITS.title),
    text: sub && !main.includes(sub) ? `${main} ${sub}`.slice(0, NOTIFY_LIMITS.text) : main,
  };
}

/** The text every regex/keyword sees: title + text, truncated to MAX_SCAN_CHARS. */
export function scanText(n: Pick<NotificationInput, "title" | "text">): string {
  return `${n.title}\n${n.text}`.slice(0, MAX_SCAN_CHARS);
}

function textMatches(value: string, pattern: string | null, mode: MatchMode): boolean {
  const p = String(pattern ?? "").trim();
  if (!p) return true;
  const v = value.slice(0, MAX_SCAN_CHARS);
  if (mode === "regex") {
    const re = compileRegex(p);
    return !!re && re.test(v);
  }
  return v.toLowerCase().includes(p.toLowerCase());
}

/** App filter: any listed substring in the package or the app name (case-insensitive). */
export function appMatches(f: Pick<NotifyFormat, "app_match">, n: NotificationInput): boolean {
  const list = keywords(f.app_match);
  if (!list.length) return true;
  const hay = `${n.package}\n${n.app}`.toLowerCase();
  return list.some((k) => hay.includes(k));
}

/** Amount from the format's regex: named group `amount`, else the first group, else the match. */
export function extractAmount(regex: string, text: string): number | null {
  const re = compileRegex(regex);
  if (!re) return null;
  const m = re.exec(text.slice(0, MAX_SCAN_CHARS));
  if (!m) return null;
  const raw = m.groups?.["amount"] ?? m.slice(1).find((x) => x != null) ?? m[0];
  return parseRupiah(raw);
}

export type ParseResult =
  | { kind: "amount"; amount: number; format: NotifyFormat; generic: boolean }
  | { kind: "ignored"; reason: string; format: NotifyFormat | null }
  | { kind: "none"; reason: string };

export const PARSE_REASON = {
  noFormat: "Tidak ada format yang cocok",
  ignored: "Mengandung kata yang diabaikan",
  noKeyword: "Tidak ada kata kunci uang masuk",
  noAmount: "Nominal tidak ditemukan",
} as const;

/**
 * Applies the enabled formats in order (first whose app/title/text filters match wins), then the
 * generic fallback when `generic` is on. Keyword checks are case-insensitive substrings.
 */
export function parseNotification(
  formats: readonly NotifyFormat[],
  n: NotificationInput,
  opts: { generic?: boolean } = {},
): ParseResult {
  const text = scanText(n);
  const lower = text.toLowerCase();
  const list = formats.filter((f) => f.enabled !== false);
  const candidates: { f: NotifyFormat; generic: boolean }[] = list
    .filter(
      (f) =>
        appMatches(f, n) &&
        textMatches(n.title, f.title_match, f.match_mode) &&
        textMatches(n.text, f.text_match, f.match_mode),
    )
    .map((f) => ({ f, generic: false }));
  if (!candidates.length && opts.generic) candidates.push({ f: GENERIC_FORMAT, generic: true });
  const first = candidates[0];
  if (!first) return { kind: "none", reason: PARSE_REASON.noFormat };
  const { f, generic } = first;
  if (keywords(f.ignore_contains).some((k) => lower.includes(k)))
    return { kind: "ignored", reason: PARSE_REASON.ignored, format: f };
  const must = keywords(f.must_contain);
  if (must.length && !must.some((k) => lower.includes(k)))
    return { kind: "ignored", reason: PARSE_REASON.noKeyword, format: f };
  const amount = extractAmount(f.amount_regex, text);
  if (amount === null) return { kind: "ignored", reason: PARSE_REASON.noAmount, format: f };
  return { kind: "amount", amount, format: f, generic };
}

/**
 * What is stored of a notification: one line, ≤ NOTIFY_LIMITS.excerpt, digit runs of 6+ (account,
 * card or reference numbers) masked except the last 3 digits. Amounts with separators survive.
 */
export function minimiseText(n: Pick<NotificationInput, "title" | "text">): string {
  return `${n.title}${n.title && n.text ? " · " : ""}${n.text}`
    .replace(/\d{6,}/g, (d) => `${"•".repeat(Math.min(6, d.length - 3))}${d.slice(-3)}`)
    .slice(0, NOTIFY_LIMITS.excerpt);
}

/** Notification time from MacroDroid's `{not_timestamp}` (ms epoch) or an ISO string; else null. */
export function postedAt(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{10,14}$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** True when the notification time is within the accepted window around `now`. */
export function isFresh(posted: number, now: number): boolean {
  return posted >= now - SIGNAL_MAX_AGE_MS && posted <= now + SIGNAL_MAX_FUTURE_MS;
}

/* ---------------- unique codes & matching ---------------- */

/** A free code in 1..999 (random start, then linear probe), or null when all are taken. */
export function pickUniqueCode(used: Iterable<number>, rand: () => number = Math.random) {
  const taken = new Set([...used].map(Number));
  const span = UNIQUE_CODE_MAX - UNIQUE_CODE_MIN + 1;
  const start = Math.floor(Math.max(0, Math.min(0.999999, rand())) * span);
  for (let i = 0; i < span; i++) {
    const code = UNIQUE_CODE_MIN + ((start + i) % span);
    if (!taken.has(code)) return code;
  }
  return null;
}

export function isUniqueCode(v: unknown): v is number {
  return (
    Number.isInteger(v) && (v as number) >= UNIQUE_CODE_MIN && (v as number) <= UNIQUE_CODE_MAX
  );
}

/** Amount the customer transfers: remaining + unique code (code only while something is due). */
export function transferAmount(remaining: number, code: number | null | undefined): number {
  const r = Math.max(0, Number(remaining) || 0);
  if (r <= EPS) return 0;
  return Math.round((r + (isUniqueCode(code) ? code : 0)) * 100) / 100;
}

export type MatchCandidate = {
  id: string;
  total: number | string;
  paid: number | string;
  unique_code: number | null;
  created_at: string;
  account_id: string | null;
};

export type MatchResult =
  | { status: "matched"; invoiceId: string }
  | { status: "ambiguous"; invoiceIds: string[] }
  | { status: "unmatched" };

/**
 * Open invoices whose remaining + unique code equals `amount` exactly, created before the
 * notification (± clock skew), optionally only into `accountId`. One → matched, more → ambiguous.
 */
export function matchSignal(
  amount: number,
  invoices: readonly MatchCandidate[],
  o: { postedAt: number; accountId?: string | null },
): MatchResult {
  const hits = invoices.filter((inv) => {
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    if (remaining <= EPS) return false;
    if (o.accountId && inv.account_id !== o.accountId) return false;
    const created = Date.parse(inv.created_at);
    if (Number.isFinite(created) && created > o.postedAt + INVOICE_CLOCK_SKEW_MS) return false;
    return Math.abs(transferAmount(remaining, inv.unique_code) - amount) < EPS;
  });
  if (hits.length === 1) return { status: "matched", invoiceId: hits[0]!.id };
  if (hits.length > 1) return { status: "ambiguous", invoiceIds: hits.map((h) => h.id) };
  return { status: "unmatched" };
}

/**
 * Splits a received amount for an invoice: `pay` (≤ remaining) books the invoice payment, `extra`
 * is the unique code part booked as its own small income (only when it equals the invoice's code).
 */
export function splitSignalAmount(
  received: number,
  remaining: number,
  code: number | null | undefined,
): { pay: number; extra: number } {
  const r = Math.max(0, Number(remaining) || 0);
  const a = Math.max(0, Number(received) || 0);
  if (isUniqueCode(code) && Math.abs(a - (r + code)) < EPS) return { pay: r, extra: code };
  return { pay: Math.round(Math.min(a, r) * 100) / 100, extra: 0 };
}

/* ---------------- signals ---------------- */

export const SIGNAL_STATUSES = [
  "unmatched",
  "matched",
  "ambiguous",
  "confirmed",
  "ignored",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
/** Statuses an admin can still confirm or ignore. */
export const OPEN_SIGNAL_STATUSES: readonly SignalStatus[] = ["unmatched", "matched", "ambiguous"];

export const SIGNAL_STATUS_LABEL: Record<SignalStatus, string> = {
  unmatched: "Tidak cocok",
  matched: "Menunggu verifikasi",
  ambiguous: "Ambigu",
  confirmed: "Dikonfirmasi",
  ignored: "Diabaikan",
};

/** Payment reference of a booked signal (also used for crash recovery). */
export const signalReference = (id: string) => `signal:${id.slice(0, 8)}`;

/** Problem with confirming a signal for an invoice (i18n key) or null. */
export function confirmProblem(
  signal: { status: string; payment_id?: string | null },
  inv: { status: string; total: number | string; paid: number | string },
  pay: number,
): string | null {
  if (!OPEN_SIGNAL_STATUSES.includes(signal.status as SignalStatus) || signal.payment_id)
    return "Notifikasi ini sudah diproses";
  if (inv.status !== "unpaid" && inv.status !== "partial")
    return "Invoice ini tidak bisa menerima pembayaran";
  if (!(pay > 0)) return "Jumlah harus lebih dari 0";
  if (pay > Number(inv.total) - Number(inv.paid) + EPS) return "Pembayaran melebihi sisa tagihan";
  return null;
}
