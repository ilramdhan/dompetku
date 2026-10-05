/** Pure text logic for the Telegram/n8n bot (client-safe, unit-testable, zero AI tokens). */
import { addDays, monthRange, shiftMonth } from "./dates";

export type Period = { start: string; end: string; label: string; key: string };

export type BotCommand =
  | { type: "balances" }
  | { type: "summary"; month: string | null }
  | { type: "report"; period: string }
  | { type: "list"; kind: "income" | "expense"; period: string }
  | { type: "reminders"; days: number | null }
  | { type: "debts" }
  | { type: "subscriptions" }
  | { type: "budget" }
  | { type: "receivables" }
  | { type: "undo" }
  | { type: "pay"; target: string }
  | { type: "withdraw"; amount: number; from: string | null }
  | { type: "help" }
  | { type: "unknown" };

const STRIP = /[%,()]/g;

const SLASH: Record<string, (arg: string) => BotCommand> = {};
const reg = (names: string[], fn: (arg: string) => BotCommand) =>
  names.forEach((n) => (SLASH[n] = fn));
const periodArg = (arg: string, def: string) => (arg.trim() ? arg.trim() : def);
reg(["start", "help", "bantuan", "menu"], () => ({ type: "help" }));
reg(["hariini", "today", "harian", "daily"], () => ({ type: "report", period: "today" }));
reg(["kemarin", "yesterday"], () => ({ type: "report", period: "yesterday" }));
reg(["minggu", "mingguan", "week", "weekly"], () => ({ type: "report", period: "week" }));
reg(["minggulalu", "lastweek"], () => ({ type: "report", period: "lastweek" }));
reg(["bulan", "bulanan", "month", "monthly", "laporan", "ringkasan", "summary", "report"], (a) => ({
  type: "report",
  period: periodArg(a, "month"),
}));
reg(["bulanlalu", "lastmonth"], () => ({ type: "report", period: "lastmonth" }));
reg(["pemasukan", "income", "masuk"], (a) => ({
  type: "list",
  kind: "income",
  period: periodArg(a, "month"),
}));
reg(["pengeluaran", "expense", "keluar"], (a) => ({
  type: "list",
  kind: "expense",
  period: periodArg(a, "month"),
}));
reg(["saldo", "balance", "balances", "akun"], () => ({ type: "balances" }));
reg(["paylater", "hutang", "utang", "cicilan", "debt", "debts"], () => ({ type: "debts" }));
reg(["langganan", "subs", "subscription", "subscriptions"], () => ({ type: "subscriptions" }));
reg(["tagihan", "pengingat", "reminder", "reminders"], (a) => ({
  type: "reminders",
  days: clampDays(a),
}));
reg(["budget", "anggaran"], () => ({ type: "budget" }));
reg(["piutang", "receivables"], () => ({ type: "receivables" }));
reg(["undo", "batal", "hapus"], () => ({ type: "undo" }));
reg(["bayar", "pay"], (a) => ({ type: "pay", target: a.trim() }));
reg(
  ["tarik", "tariktunai", "atm", "withdraw"],
  (a) => withdraw(a) ?? { type: "withdraw", amount: 0, from: null },
);

/** Explicit day window (≤ 90) or null = use the Settings reminder days (default 14). */
function clampDays(a: string): number | null {
  const n = Number(a.trim());
  return a.trim() && Number.isFinite(n) && n > 0 ? Math.min(90, Math.round(n)) : null;
}

function withdraw(rest: string): BotCommand | null {
  const w = rest.trim().match(/^([\d.,]+)\s*(rb|ribu|k|jt|juta)?(?:\s+(?:dari|from)\s+(.+))?$/);
  return w
    ? { type: "withdraw", amount: parseAmount(w[1]!, w[2]), from: w[3]?.trim() || null }
    : null;
}

export function classifyBotCommand(raw: string): BotCommand {
  const text = raw.toLowerCase().trim();
  // Slash commands: "/minggu", "/bulan 2026-05", "/bayar@MyBot netflix"
  const s = text.match(/^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/);
  if (s) {
    const fn = SLASH[s[1]!.replace(/_/g, "")];
    return fn ? fn(s[2] ?? "") : { type: "unknown" };
  }
  // Plain-text commands (kept narrow so normal expenses like "bayar listrik 300rb" stay transactions)
  if (/^(saldo|cek saldo|balance|balances)$/.test(text)) return { type: "balances" };
  if (/^(laporan|ringkasan|summary|report)(\s+\d{4}-\d{2})?$/.test(text)) {
    const m = text.match(/\d{4}-\d{2}/);
    return { type: "summary", month: m ? m[0]! : null };
  }
  if (/^(pengingat|reminders?|tagihan)$/.test(text)) return { type: "reminders", days: null };
  if (/^(bantuan|help|menu)$/.test(text)) return { type: "help" };
  if (/^(undo|batal)$/.test(text)) return { type: "undo" };
  const pay = text.match(/^(sudah dibayar|sudah bayar|bayar|paid|pay)\s+([^\d]+)$/);
  if (pay) return { type: "pay", target: pay[2]!.trim() };
  const w = text.match(/^(?:tarik tunai|tarik|ambil tunai|atm|withdraw)\s+(.+)$/);
  if (w) {
    const r = withdraw(w[1]!);
    if (r) return r;
  }
  return { type: "unknown" };
}

export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: "hariini", description: "Laporan hari ini" },
  { command: "kemarin", description: "Laporan kemarin" },
  { command: "minggu", description: "Laporan minggu ini" },
  { command: "bulan", description: "Laporan bulan ini (opsional YYYY-MM)" },
  { command: "bulanlalu", description: "Laporan bulan lalu" },
  { command: "pemasukan", description: "Daftar pemasukan (hariini/minggu/bulan)" },
  { command: "pengeluaran", description: "Daftar pengeluaran (hariini/minggu/bulan)" },
  { command: "saldo", description: "Saldo semua akun" },
  { command: "paylater", description: "Paylater, cicilan & hutang" },
  { command: "langganan", description: "Langganan aktif & tagihan" },
  { command: "tagihan", description: "Tagihan jatuh tempo (opsional jumlah hari)" },
  { command: "budget", description: "Pemakaian budget bulan ini" },
  { command: "piutang", description: "Piutang yang belum lunas" },
  { command: "bayar", description: "Catat bayar langganan/cicilan: /bayar netflix" },
  { command: "tarik", description: "Tarik tunai: /tarik 500rb dari BCA" },
  { command: "undo", description: "Hapus transaksi terakhir dari bot" },
  { command: "help", description: "Bantuan" },
];

export function botHelp(): string {
  return [
    "🤖 Dompetku Bot",
    "",
    "Catat transaksi cukup dengan chat, contoh:",
    "• kopi 25rb",
    "• makan siang 45.000 pakai gopay",
    "• gaji masuk 8jt ke BCA",
    "• netflix $15",
    "• kirim foto struk untuk OCR",
    "Semua transaksi tampil sebagai pratinjau dulu, tekan ✅ untuk menyimpan.",
    "",
    "Perintah:",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`),
  ].join("\n");
}

export function botSearchToken(target: string): string {
  return target.replace(STRIP, "").trim();
}

/**
 * "25.000" → 25000, "25.000,50" → 25000.5, "1.5" → 1.5, "1,299.99" → 1299.99.
 * A final "." or "," followed by 1–2 digits is the decimal mark; separators before 3 digits are thousands.
 */
export function parseNumber(num: string): number {
  const dec = num.match(/^(.*?)[.,](\d{1,2})$/);
  const n = dec
    ? Number(`${dec[1]!.replace(/[.,]/g, "") || "0"}.${dec[2]}`)
    : Number(num.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** "500rb" → 500000, "1,5jt" / "1.5jt" → 1500000, "250.000" → 250000, "25.000,50" → 25000.5. */
export function parseAmount(num: string, unit?: string): number {
  const mult = !unit ? 1 : /^(rb|ribu|k)$/.test(unit) ? 1_000 : 1_000_000;
  const n = parseNumber(num);
  if (!Number.isFinite(n)) return 0;
  return unit ? Math.round(n * mult) : Math.round(n * 100) / 100;
}

/** Real calendar date check ("2026-02-31" and "2026-13-01" are rejected). */
export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** Telegram rejects messages over 4096 characters; cut at a line boundary with a note. */
export const TELEGRAM_TEXT_MAX = 4096;
export function clampMessage(text: string, max = TELEGRAM_TEXT_MAX): string {
  if (text.length <= max) return text;
  const note = "\n… (terpotong, lihat selengkapnya di web)";
  const room = max - note.length;
  const cut = text.lastIndexOf("\n", room);
  return text.slice(0, cut > room / 2 ? cut : room) + note;
}

/* ---------------- Periods ---------------- */
function mondayOf(d: string): string {
  const dow = new Date(d + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

const fmtDay = (d: string) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(d + "T00:00:00Z"));
const fmtMonth = (m: string) =>
  new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(m + "-01T00:00:00Z"),
  );

/** Resolve a period keyword into a half-open date range [start, end). */
export function resolvePeriod(spec: string, today: string): Period | null {
  const k = spec.toLowerCase().replace(/[\s_-]/g, "");
  const day = (d: string, label: string, key: string): Period => ({
    start: d,
    end: addDays(d, 1),
    label: `${label} (${fmtDay(d)})`,
    key,
  });
  if (["today", "hariini", "harian"].includes(k)) return day(today, "Hari ini", "today");
  if (["yesterday", "kemarin"].includes(k)) return day(addDays(today, -1), "Kemarin", "yesterday");
  if (["week", "minggu", "mingguini", "mingguan"].includes(k)) {
    const s = mondayOf(today);
    return {
      start: s,
      end: addDays(today, 1),
      label: `Minggu ini (${fmtDay(s)} – ${fmtDay(today)})`,
      key: "week",
    };
  }
  if (["lastweek", "minggulalu"].includes(k)) {
    const s = addDays(mondayOf(today), -7);
    return {
      start: s,
      end: addDays(s, 7),
      label: `Minggu lalu (${fmtDay(s)} – ${fmtDay(addDays(s, 6))})`,
      key: "lastweek",
    };
  }
  if (["month", "bulan", "bulanini", "bulanan"].includes(k)) {
    const m = today.slice(0, 7);
    return { ...monthRange(m), label: fmtMonth(m), key: "month" };
  }
  if (["lastmonth", "bulanlalu"].includes(k)) {
    const m = shiftMonth(today.slice(0, 7), -1);
    return { ...monthRange(m), label: fmtMonth(m), key: "lastmonth" };
  }
  if (/^\d{4}-\d{2}$/.test(spec.trim())) {
    const m = spec.trim();
    if (!isValidDate(`${m}-01`)) return null;
    return { ...monthRange(m), label: fmtMonth(m), key: m };
  }
  if (isValidDate(spec.trim())) return day(spec.trim(), "Tanggal", spec.trim());
  return null;
}

/** Previous range of equal length (for "vs periode sebelumnya"). */
export function previousRange(p: { start: string; end: string }): { start: string; end: string } {
  const len = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000);
  if (p.start.endsWith("-01") && p.end.endsWith("-01") && len >= 28) {
    const m = shiftMonth(p.start.slice(0, 7), -1);
    return monthRange(m);
  }
  return { start: addDays(p.start, -len), end: p.start };
}

/* ---------------- Category matching ---------------- */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*\((income|expense)\)\s*$/i, "")
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Map an AI/keyword category label onto an existing category name (case/suffix-insensitive). */
export function matchCategory(label: string | null | undefined, existing: string[]): string | null {
  if (!label) return null;
  const n = norm(label);
  if (!n) return null;
  const exact = existing.find((e) => norm(e) === n);
  if (exact) return exact;
  const partial = existing.find(
    (e) => norm(e).includes(n) || (n.length >= 4 && n.includes(norm(e))),
  );
  if (partial) return partial;
  const first = n.split(" ")[0]!;
  return first.length >= 4
    ? (existing.find((e) => norm(e).split(" ").includes(first)) ?? null)
    : null;
}

/** Keyword → default category name (schema seeds). Order matters: food before transport ("grabfood"). */
const KEYWORDS: [string, string[]][] = [
  ["Gaji", ["gaji", "gajian", "salary", "payroll"]],
  ["Bonus", ["bonus", "thr", "insentif"]],
  ["Freelance", ["freelance", "proyek", "project", "honor", "fee project"]],
  [
    "Langganan",
    [
      "netflix",
      "spotify",
      "youtube premium",
      "disney",
      "icloud",
      "chatgpt",
      "claude",
      "google one",
      "vidio",
      "langganan",
      "subscription",
      "gym",
      "membership",
    ],
  ],
  [
    "Makanan & Minuman",
    [
      "makan",
      "minum",
      "kopi",
      "coffee",
      "cafe",
      "kafe",
      "resto",
      "restoran",
      "warung",
      "warteg",
      "bakso",
      "nasi",
      "mie",
      "mi",
      "ayam",
      "sate",
      "soto",
      "snack",
      "jajan",
      "gofood",
      "grabfood",
      "shopeefood",
      "sarapan",
      "lunch",
      "dinner",
      "brunch",
      "starbucks",
      "mcd",
      "kfc",
      "boba",
      "teh",
      "roti",
      "martabak",
      "pizza",
      "burger",
      "seblak",
      "gorengan",
      "es",
      "jus",
    ],
  ],
  [
    "Transportasi",
    [
      "bensin",
      "pertalite",
      "pertamax",
      "solar",
      "bbm",
      "parkir",
      "tol",
      "etoll",
      "e-toll",
      "ojek",
      "ojol",
      "gojek",
      "goride",
      "gocar",
      "grab",
      "grabcar",
      "grabbike",
      "maxim",
      "taksi",
      "taxi",
      "krl",
      "mrt",
      "lrt",
      "transjakarta",
      "busway",
      "bus",
      "kereta",
      "tiket kereta",
      "uber",
      "servis motor",
      "service motor",
      "cuci motor",
      "cuci mobil",
    ],
  ],
  [
    "Tagihan & Utilitas",
    [
      "listrik",
      "pln",
      "token listrik",
      "pdam",
      "air",
      "internet",
      "wifi",
      "indihome",
      "biznet",
      "first media",
      "pulsa",
      "kuota",
      "paket data",
      "gas",
      "elpiji",
      "lpg",
      "bpjs",
      "iuran",
      "ipl",
      "kos",
      "kost",
      "sewa",
    ],
  ],
  [
    "Kesehatan",
    [
      "obat",
      "apotek",
      "apotik",
      "dokter",
      "klinik",
      "rumah sakit",
      "rs",
      "vitamin",
      "halodoc",
      "periksa",
      "gigi",
    ],
  ],
  [
    "Pendidikan",
    [
      "buku",
      "kursus",
      "sekolah",
      "kuliah",
      "spp",
      "udemy",
      "coursera",
      "les",
      "seminar",
      "workshop",
    ],
  ],
  [
    "Hiburan",
    [
      "bioskop",
      "nonton",
      "film",
      "game",
      "steam",
      "topup game",
      "karaoke",
      "konser",
      "liburan",
      "wisata",
      "hotel",
    ],
  ],
  [
    "Belanja",
    [
      "belanja",
      "indomaret",
      "alfamart",
      "alfamidi",
      "supermarket",
      "superindo",
      "hypermart",
      "giant",
      "transmart",
      "shopee",
      "tokopedia",
      "lazada",
      "tiktok shop",
      "baju",
      "celana",
      "sepatu",
      "mall",
      "sabun",
      "skincare",
      "deterjen",
    ],
  ],
];

export function guessCategory(text: string, existing: string[]): string | null {
  const t = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")} `;
  for (const [cat, words] of KEYWORDS) {
    if (words.some((w) => t.includes(` ${w} `))) {
      const m = matchCategory(cat, existing);
      if (m) return m;
    }
  }
  return null;
}

/* ---------------- Quick parser (no AI) ---------------- */
export type QuickDraft = {
  kind: "income" | "expense";
  amount: number;
  currency: "IDR" | "USD";
  description: string;
  date: string;
  account: string | null;
};

const INCOME =
  /\b(gaji|gajian|bonus|thr|pemasukan|income|masuk|terima|diterima|dapat|dapet|cashback|refund|dividen|bunga|jual|dibayar|transferan|komisi|honor)\b/;
const INCOME_OR_FILLER =
  /\b(beli|bayar|buat|untuk|utk|masuk|pemasukan|pengeluaran|topup|top up|isi)\b/gi;
const AMBIGUOUS =
  /\b(tgl|tanggal|lusa|minggu lalu|bulan lalu|senin|selasa|rabu|kamis|jumat|sabtu|cicil|pinjam|minjem|hutang|utang|transfer ke|tf ke|kirim ke|bagi|split|patungan)\b/;
const AMOUNT_RE =
  /(?:(rp\.?|idr|\$|usd)\s*)?(\d+(?:[.,]\d+)*)\s*(rb|ribu|k|jt|juta|usd|dolar|dollar)?(?![\w])/g;

/**
 * Parse simple chats like "kopi 25rb", "gaji 8jt ke BCA", "netflix $15", "makan 45.000 pakai gopay kemarin".
 * Returns null when unsure so the caller can fall back to AI.
 */
export function quickParse(raw: string, today: string, accounts: string[]): QuickDraft | null {
  let text = raw.trim();
  if (!text || text.length > 200 || text.includes("\n")) return null;
  const lower = text.toLowerCase();
  if (AMBIGUOUS.test(lower)) return null;

  const hits = [...lower.matchAll(AMOUNT_RE)].filter((m) => /\d/.test(m[2]!));
  const strong = hits.filter((m) => m[1] || m[3]);
  const pick = strong.length === 1 ? strong[0]! : hits.length === 1 ? hits[0]! : null;
  if (!pick) return null;
  const prefix = (pick[1] ?? "").replace(".", "");
  const unit = pick[3];
  const usd = prefix === "$" || prefix === "usd" || /^(usd|dolar|dollar)$/.test(unit ?? "");
  const amount = parseAmount(
    pick[2]!,
    !usd && unit && /^(rb|ribu|k|jt|juta)$/.test(unit) ? unit : undefined,
  );
  // numeric(18,2) overflows above 1e16; anything this large is a typo, let AI/the user decide.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return null;
  if (!usd && !unit && amount < 100) return null; // "2 kopi" etc. — too ambiguous

  text = (text.slice(0, pick.index) + " " + text.slice(pick.index! + pick[0].length)).trim();

  let date = today;
  if (/\bkemarin\b/i.test(text)) {
    date = addDays(today, -1);
    text = text.replace(/\bkemarin\b/i, " ");
  }
  text = text.replace(/\bhari ini\b/i, " ");

  let account: string | null = null;
  const via = text.match(/\b(?:pakai|pake|pk|via|dari|lewat|ke|masuk ke|by)\s+([\w .-]{2,40})$/i);
  const findAcc = (s: string) => {
    const n = s.toLowerCase().trim();
    return (
      accounts.find((a) => a.toLowerCase() === n) ??
      accounts.find((a) => a.toLowerCase().includes(n) || n.includes(a.toLowerCase())) ??
      null
    );
  };
  if (via) {
    account = findAcc(via[1]!);
    if (account) text = text.slice(0, via.index).trim();
  }
  if (!account) {
    // Bare account name only as the trailing word(s) ("makan 30rb gopay"), and only when something
    // else remains as the description — so "dana darurat 500rb" / "bayar dana" keep "dana" as a word.
    for (const a of [...accounts].sort((x, y) => y.length - x.length)) {
      const esc = a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|\\s)${esc}[\\s.,!]*$`, "i");
      const rest = text.replace(re, " ").trim();
      if (a.length >= 3 && re.test(text) && /[a-z]{2}/i.test(rest.replace(INCOME_OR_FILLER, ""))) {
        account = a;
        text = rest;
        break;
      }
    }
  }

  const kind: "income" | "expense" = INCOME.test(lower) ? "income" : "expense";
  const description = text
    .replace(/\b(beli|bayar|buat|untuk|utk|masuk|pemasukan|pengeluaran)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[-,.:\s]+|[-,.:\s]+$/g, "")
    .trim();
  return {
    kind,
    amount,
    currency: usd ? "USD" : "IDR",
    description: description ? description[0]!.toUpperCase() + description.slice(1) : "",
    date,
    account,
  };
}

/* ---------------- Telegram UI (pure) ---------------- */
export type DraftPayload = {
  kind: "income" | "expense";
  amount: number;
  currency: "IDR" | "USD";
  category: string | null;
  account: string | null;
  description: string | null;
  merchant: string | null;
  date: string;
  items: { name: string; qty?: number | null | undefined; price?: number | null | undefined }[];
  via: "quick" | "ai" | "ocr";
};

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

export function money(n: number, c: string): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: c,
    maximumFractionDigits: c === "USD" ? 2 : 0,
  }).format(n);
}

export function previewText(d: DraftPayload, defaultAccount: string | null): string {
  const lines = [
    d.via === "ocr" ? "🧾 Pratinjau nota" : "📝 Pratinjau transaksi",
    "",
    `Jenis: ${d.kind === "income" ? "💰 Pemasukan" : "💸 Pengeluaran"}`,
    `Jumlah: ${money(d.amount, d.currency)}`,
    `Kategori: ${d.category ?? "-"}`,
    `Akun: ${d.account ?? (defaultAccount ? `${defaultAccount} (default)` : "-")}`,
    `Tanggal: ${fmtDay(d.date)}`,
  ];
  if (d.description) lines.push(`Ket: ${d.description}`);
  if (d.merchant && d.merchant !== d.description) lines.push(`Merchant: ${d.merchant}`);
  if (d.items.length) {
    lines.push(`Item (${d.items.length}):`);
    for (const it of d.items.slice(0, 8))
      lines.push(
        `  • ${it.name}${it.qty && it.qty > 1 ? ` x${it.qty}` : ""}${it.price ? ` — ${money(it.price, d.currency)}` : ""}`,
      );
    if (d.items.length > 8) lines.push(`  … +${d.items.length - 8} item lain`);
  }
  lines.push(
    "",
    d.via === "quick" ? "⚡ Dibaca tanpa AI" : "🤖 Dibaca AI — periksa sebelum simpan",
  );
  return lines.join("\n");
}

export function previewKeyboard(id: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Simpan", callback_data: `d:s:${id}` },
        { text: "❌ Batal", callback_data: `d:x:${id}` },
      ],
      [
        { text: "🏷 Kategori", callback_data: `d:c:${id}` },
        { text: "🏦 Akun", callback_data: `d:a:${id}` },
        { text: "🔁 Masuk/Keluar", callback_data: `d:k:${id}` },
      ],
    ],
  };
}

/** Option picker; callback carries the index into the (sorted) option list to stay under Telegram's 64-byte limit. */
export function pickerKeyboard(
  id: string,
  op: "C" | "A",
  options: string[],
  extra?: { text: string; idx: number },
): InlineKeyboard {
  const buttons = options.slice(0, 40).map((o, i) => ({
    text: Array.from(o).slice(0, 30).join(""),
    callback_data: `d:${op}:${id}:${i}`,
  }));
  if (extra) buttons.push({ text: extra.text, callback_data: `d:${op}:${id}:${extra.idx}` });
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: "⬅️ Kembali", callback_data: `d:b:${id}` }]);
  return { inline_keyboard: rows };
}

export function undoKeyboard(txId: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: "↩️ Undo", callback_data: `u:${txId}` }]] };
}

export type Callback =
  | {
      kind: "draft";
      op: "s" | "x" | "c" | "a" | "k" | "b" | "C" | "A";
      id: string;
      idx: number | null;
    }
  | { kind: "undo"; id: string }
  | null;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function parseCallback(data: string): Callback {
  const d = data.match(new RegExp(`^d:([sxcakbCA]):(${UUID})(?::(\\d{1,3}))?$`));
  if (d)
    return { kind: "draft", op: d[1] as "s", id: d[2]!, idx: d[3] != null ? Number(d[3]) : null };
  const u = data.match(new RegExp(`^u:(${UUID})$`));
  return u ? { kind: "undo", id: u[1]! } : null;
}

/* ---------------- AI text gate (pure) ---------------- */
/** Longest chat text that may be sent to AI; longer messages are refused without a call. */
export const BOT_AI_TEXT_MAX = 300;

/** Indonesian number words and money slang that can carry an amount without digits. */
const AMOUNT_WORDS =
  /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|puluhan|ratus|ratusan|seratus|ribu|ribuan|seribu|juta|jutaan|sejuta|miliar|milyar|triliun|setengah|rb|rban|jt|jtan|rp|idr|usd|dolar|dollar|goceng|gocap|gopek|ceban|cepek|seceng|ceceng|noban|cetiao|sejeti)\b/i;

/** True when the text could contain an amount: any digit, or a number word / money slang. */
export function hasAmountSignal(text: string): boolean {
  return /\d/.test(text) || AMOUNT_WORDS.test(text);
}

export type AiTextGate = { ok: true } | { ok: false; reason: "no_amount" | "too_long" };

/** Decides whether an unparsed chat may go to AI: no amount signal or over-long text never does. */
export function aiTextGate(text: string): AiTextGate {
  const t = text.trim();
  if (t.length > BOT_AI_TEXT_MAX) return { ok: false, reason: "too_long" };
  if (!hasAmountSignal(t)) return { ok: false, reason: "no_amount" };
  return { ok: true };
}
