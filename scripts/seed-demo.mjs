#!/usr/bin/env node
/**
 * Seed a throwaway database with realistic, fully fictional demo data (see docs/DEMO-DATA.md).
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-demo.mjs [--reset]
 *
 * - 14 months of Indonesian personal-finance history (IDR + a USD investment account).
 * - Deterministic: a seeded PRNG drives every amount/choice, so screenshots are reproducible for
 *   the same "today" (override with DEMO_TODAY=YYYY-MM-DD; default = today in APP_TIMEZONE).
 * - Uses the app's own data shapes: amount_idr, notes markers ([auto:recurring:…],
 *   [auto:monthly_fee:…], [fee:…], [goal:…]), external_id for recurring items, linked
 *   Piutang/Emas/Cicilan transactions, split_group, items JSON.
 * - Refuses to touch a non-local database unless BOTH --allow-remote is passed and
 *   DEMO_RESET_CONFIRM=yes is set (used by .github/workflows/demo-reset.yml for the public demo).
 * - Without --reset it stops when accounts already exist; --reset wipes ALL app data first —
 *   every table (incl. visitor rows, activity log, bot drafts, budget alerts), categories back to
 *   the schema defaults, app_settings back to defaults and every object in the receipts bucket.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { defaultCategoriesFromSchema, parseSeedArgs } from "./seed-args.mjs";

const parsed = parseSeedArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const RESET = parsed.reset;
const URL_ = parsed.url;
const KEY = parsed.key;

const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/* ---------------- deterministic helpers ---------------- */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260425);
const idRnd = mulberry32(777);
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
/** Random amount in [min,max] rounded to `step` (e.g. 500 / 1000 rupiah). */
const amt = (min, max, step = 500) => Math.round(int(min, max) / step) * step;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const uuid = () => {
  const h = [...Array(32)].map(() => Math.floor(idRnd() * 16).toString(16));
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

const TZ = process.env.APP_TIMEZONE || "Asia/Jakarta";
const TODAY =
  process.env.DEMO_TODAY ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const [TY, TM, TD] = TODAY.split("-").map(Number);
const pad = (n) => String(n).padStart(2, "0");
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Month offset from the current month (0 = this month, -1 = last month …) → {y, m}. */
const monthAt = (off) => {
  const d = new Date(Date.UTC(TY, TM - 1 + off, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};
const dateIn = (off, day) => {
  const { y, m } = monthAt(off);
  return `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
};
const ym = (off) => dateIn(off, 1).slice(0, 7);
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const past = (date) => date <= TODAY;
const ts = (date, hh = 9, mm = 0) => `${date}T${pad(hh)}:${pad(mm)}:00+07:00`;

const MONTHS = 14; // offsets -13 … 0

/* ---------------- reset / guard ---------------- */
const WIPE = [
  "budget_alerts",
  "account_reconciliations",
  "bot_drafts",
  "app_settings",
  "recurring_transactions",
  "receivable_payments",
  "receivables",
  "gold_purchases",
  "debt_payments",
  "debts",
  "subscriptions",
  "budgets",
  "goals",
  "transactions",
  "accounts",
  "activity_log",
  "app_users",
  "categories",
];
const DEFAULT_CATEGORIES = defaultCategoriesFromSchema(
  readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
);
const EXTRA_CATEGORIES = [
  { name: "Sewa & Rumah", kind: "expense", color: "#7a5c8a" },
  { name: "Dividen", kind: "income", color: "#3d7ea6" },
];
const missing = (e) =>
  e && /does not exist|Could not find the table|PGRST205|42P01/i.test(e.message);

async function reset() {
  for (const t of WIPE) {
    const { error } = await sb.from(t).delete().not("id", "is", null);
    if (error && !missing(error)) throw new Error(`${t}: ${error.message}`);
  }
  for (const [t, col] of [
    ["fx_rates", "rate_date"],
    ["gold_prices", "price_date"],
  ]) {
    const { error } = await sb.from(t).delete().gte(col, "1900-01-01");
    if (error && !missing(error)) throw new Error(`${t}: ${error.message}`);
  }
  // Categories: back to exactly the schema defaults (visitors may have renamed/deleted them).
  const cats = await sb.from("categories").upsert(DEFAULT_CATEGORIES, { onConflict: "name,kind" });
  if (cats.error) throw new Error(`categories: ${cats.error.message}`);
  await wipeReceipts();
  console.log("Reset: all tables, categories, app settings and receipt photos wiped.");
}

/** Removes every object from the private `receipts` bucket (missing bucket = nothing to do). */
async function wipeReceipts() {
  const bucket = sb.storage.from("receipts");
  const walk = async (prefix) => {
    const paths = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
      if (error) {
        if (/not found|does not exist/i.test(error.message)) return paths;
        throw new Error(`storage: ${error.message}`);
      }
      for (const o of data ?? []) {
        const p = prefix ? `${prefix}/${o.name}` : o.name;
        if (o.id === null)
          paths.push(...(await walk(p))); // folder
        else paths.push(p);
      }
      if ((data ?? []).length < 1000) return paths;
    }
  };
  const paths = await walk("");
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await bucket.remove(paths.slice(i, i + 500));
    if (error) throw new Error(`storage: ${error.message}`);
  }
  if (paths.length) console.log(`Reset: removed ${paths.length} receipt photo(s).`);
}

async function insert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 500), { defaultToNull: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/* ---------------- main ---------------- */
async function main() {
  const probe = await sb.from("accounts").select("id", { count: "exact", head: true });
  if (probe.error)
    throw new Error(`accounts: ${probe.error.message} — run scripts/dev-db/apply-schema.sh first`);
  if (RESET) await reset();
  else if ((probe.count ?? 0) > 0) {
    console.error("Database already has accounts. Re-run with --reset to wipe and reseed.");
    process.exit(1);
  }

  /* ----- categories ----- */
  await sb.from("categories").upsert(EXTRA_CATEGORIES, { onConflict: "name,kind" });
  const cats = await sb.from("categories").select("id, name, kind");
  if (cats.error) throw new Error(cats.error.message);
  const cat = (name, kind = "expense") => {
    const c = cats.data.find((x) => x.name === name && x.kind === kind);
    if (!c) throw new Error(`category missing: ${name} (${kind}) — apply the full schema first`);
    return c.id;
  };

  /* ----- fx rates (USD→IDR, one per day) ----- */
  const fxStart = dateIn(-(MONTHS - 1), 1);
  const fx = new Map();
  let rate = 15850;
  for (let d = fxStart; d <= TODAY; d = addDays(d, 1)) {
    rate = Math.min(16750, Math.max(15600, rate + int(-45, 50)));
    fx.set(d, rate);
  }
  const fxAt = (d) => fx.get(d) ?? rate;

  /* ----- accounts ----- */
  const A = {
    bca: uuid(),
    mandiri: uuid(),
    gopay: uuid(),
    ovo: uuid(),
    cash: uuid(),
    cc: uuid(),
    usd: uuid(),
  };
  const accounts = [
    {
      id: A.bca,
      name: "BCA",
      type: "bank",
      currency: "IDR",
      initial_balance: 14_500_000,
      color: "#2f5d9e",
      transfer_fees: [
        { label: "BI-FAST", amount: 2500 },
        { label: "Online", amount: 6500 },
      ],
    },
    {
      id: A.mandiri,
      name: "Mandiri Tabungan",
      type: "bank",
      currency: "IDR",
      initial_balance: 6_000_000,
      color: "#c9a227",
      monthly_fee: 12500,
      monthly_fee_day: 28,
    },
    {
      id: A.gopay,
      name: "GoPay",
      type: "ewallet",
      currency: "IDR",
      initial_balance: 250_000,
      color: "#2f9e8f",
      topup_fees: [{ label: "Top up", amount: 1000 }],
    },
    {
      id: A.ovo,
      name: "OVO",
      type: "ewallet",
      currency: "IDR",
      initial_balance: 120_000,
      color: "#6b4fa0",
    },
    {
      id: A.cash,
      name: "Tunai",
      type: "cash",
      currency: "IDR",
      initial_balance: 650_000,
      color: "#5a7d4f",
    },
    {
      id: A.cc,
      name: "Kartu Kredit",
      type: "credit_card",
      currency: "IDR",
      initial_balance: 0,
      color: "#a14a4a",
    },
    {
      id: A.usd,
      name: "Reksa Dana USD",
      type: "investment",
      currency: "USD",
      initial_balance: 2400,
      color: "#3d7ea6",
    },
  ];
  const created0 = ts(dateIn(-(MONTHS - 1), 1), 8);
  await insert(
    "accounts",
    accounts.map((a) => ({ archived: false, created_at: created0, ...a })),
  );

  /* ----- transactions ----- */
  const tx = [];
  const add = (t) => {
    const id = t.id ?? uuid();
    const currency = t.currency ?? "IDR";
    const amount = Math.round(t.amount * 100) / 100;
    tx.push({
      id,
      kind: t.kind,
      amount,
      currency,
      amount_idr: currency === "USD" ? Math.round(amount * fxAt(t.date)) : amount,
      account_id: t.account ?? null,
      to_account_id: t.to ?? null,
      category_id: t.category ?? null,
      description: t.description ?? null,
      merchant: t.merchant ?? null,
      occurred_at: t.date,
      source: t.source ?? "web",
      items: t.items ?? null,
      notes: t.notes ?? null,
      external_id: t.external_id ?? null,
      split_group: t.split_group ?? null,
      created_at: ts(t.date, int(7, 21), int(0, 59)),
    });
    return id;
  };
  /** Transfer with an optional admin fee row ([fee:<id>] marker, category Biaya Admin). */
  const transfer = (t, fee = 0) => {
    const id = add({ ...t, kind: "transfer" });
    if (fee > 0)
      add({
        kind: "expense",
        amount: fee,
        account: t.account,
        category: cat("Biaya Admin"),
        description: `Biaya transfer${t.description ? `: ${t.description}` : ""}`,
        date: t.date,
        notes: `[fee:${id}]`,
      });
    return id;
  };

  /* recurring definitions (posted occurrences carry marker + external_id) */
  const R = {
    salary: uuid(),
    rent: uuid(),
    topup: uuid(),
    trash: uuid(),
  };
  const recurringPost = (rid, due, t) =>
    add({
      ...t,
      date: due,
      notes: `[auto:recurring:${rid}:${due}]`,
      external_id: `recurring:${rid}:${due}`,
    });

  const goals = {
    emergency: { id: uuid(), saved: 0 },
    japan: { id: uuid(), saved: 0 },
  };
  const ccSpend = new Map(); // month offset → credit-card spending
  const ccAdd = (off, a) => ccSpend.set(off, (ccSpend.get(off) ?? 0) + a);

  const FOOD = [
    "Warung Nasi Bu Sari",
    "Kopi Senja",
    "Bakso Pak Kumis",
    "Sate Madura Cak Rofi",
    "Mie Ayam Jaya",
    "Ayam Geprek Mantap",
    "Roti Bakar 88",
    "Soto Betawi Bang Udin",
    "Kedai Kopi Rimba",
    "Padang Sederhana Rasa",
  ];
  const GROCER = [
    "Supermarket Segar",
    "Toko Sembako Makmur",
    "Pasar Pagi Kebayoran",
    "Minimarket Cahaya",
  ];
  const GROCERY_ITEMS = [
    ["Beras 5 kg", 78000],
    ["Minyak goreng 2 L", 38000],
    ["Telur 1 kg", 29000],
    ["Gula pasir 1 kg", 18500],
    ["Susu UHT 1 L", 21000],
    ["Sabun cuci piring", 15500],
    ["Deterjen 800 g", 27000],
    ["Kopi bubuk 200 g", 32000],
    ["Mi instan (5)", 16500],
    ["Ayam potong 1 kg", 42000],
    ["Sayur bayam", 6000],
    ["Tahu & tempe", 14000],
    ["Pasta gigi", 17500],
    ["Air mineral galon", 22000],
  ];
  const groceryItems = () => {
    const n = int(3, 7);
    const pool = [...GROCERY_ITEMS];
    const items = [];
    for (let i = 0; i < n; i++) {
      const [name, price] = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      items.push({ name, qty: int(1, 3), price });
    }
    return items;
  };
  const itemsTotal = (items) => items.reduce((s, i) => s + i.qty * i.price, 0);

  for (let off = -(MONTHS - 1); off <= 0; off++) {
    const d = (day) => dateIn(off, day);
    // Salary (25th) & bonus
    if (past(d(25)))
      recurringPost(R.salary, d(25), {
        kind: "income",
        amount: 18_500_000,
        account: A.bca,
        category: cat("Gaji", "income"),
        description: "Gaji bulanan",
        merchant: "PT Contoh Sejahtera",
      });
    // Rent (1st)
    if (past(d(1)))
      recurringPost(R.rent, d(1), {
        kind: "expense",
        amount: 3_800_000,
        account: A.bca,
        category: cat("Sewa & Rumah"),
        description: "Sewa apartemen",
        merchant: "Apartemen Taman Melati",
      });
    // GoPay top up (2nd)
    if (past(d(2)))
      recurringPost(R.topup, d(2), {
        kind: "transfer",
        amount: 750_000,
        account: A.bca,
        to: A.gopay,
        description: "Top up GoPay",
      });
    // OVO top-up with fee (mid month)
    if (past(d(14)))
      transfer(
        { amount: 300_000, account: A.bca, to: A.ovo, description: "Top up OVO", date: d(14) },
        1000,
      );
    // ATM cash withdrawal
    if (past(d(6)))
      transfer({
        amount: 500_000,
        account: A.bca,
        to: A.cash,
        description: "Tarik tunai",
        date: d(6),
      });

    // Utilities
    const bills = [
      [5, "Listrik PLN", "PLN", amt(380_000, 620_000)],
      [7, "Air PDAM", "PDAM Kota", amt(95_000, 160_000)],
      [9, "Internet rumah", "NetHome Fiber", 349_000],
      [12, "Pulsa & data", "Operator Seluler", amt(100_000, 150_000, 5000)],
    ];
    for (const [day, desc, merchant, a] of bills)
      if (past(d(day)))
        add({
          kind: "expense",
          amount: a,
          account: A.bca,
          category: cat("Tagihan & Utilitas"),
          description: desc,
          merchant,
          date: d(day),
        });

    // Subscriptions (credit card): Netflix, Spotify, iCloud (+11% tax)
    const subs = [
      [3, "Netflix", 186_000],
      [11, "Spotify", 64_990],
      [17, "iCloud+", Math.round(49_000 * 1.11 * 100) / 100],
    ];
    for (const [day, name, a] of subs)
      if (past(d(day))) {
        add({
          kind: "expense",
          amount: a,
          account: A.cc,
          category: cat("Langganan"),
          description: `Langganan ${name}`,
          merchant: name,
          date: d(day),
        });
        ccAdd(off, a);
      }

    // Groceries: 4–6 trips, some scanned receipts with items
    // Current month: draw days only up to today and scale counts to the days elapsed, so the
    // dashboard always shows realistic month-to-date activity (never an empty month).
    const upTo = off === 0 ? Math.max(1, TD) : 28;
    const share = (n, min) => (off === 0 ? Math.max(min, Math.round((n * TD) / 30)) : n);
    const trips = share(int(4, 6), 2);
    for (let i = 0; i < trips; i++) {
      const day = int(1, upTo);
      const scanned = rnd() < 0.5;
      const items = scanned ? groceryItems() : null;
      const a = items ? itemsTotal(items) : amt(120_000, 480_000);
      const onCc = rnd() < 0.3;
      if (!past(d(day))) continue;
      add({
        kind: "expense",
        amount: a,
        account: onCc ? A.cc : A.bca,
        category: cat("Belanja"),
        description: "Belanja dapur",
        merchant: pick(GROCER),
        date: d(day),
        items,
        source: scanned ? "ocr" : "web",
      });
      if (onCc) ccAdd(off, a);
    }

    // Dining: 9–13 meals
    const meals = share(int(9, 13), 4);
    for (let i = 0; i < meals; i++) {
      const day = int(1, upTo);
      const a = amt(22_000, 165_000);
      const acc = pick([A.gopay, A.gopay, A.ovo, A.cash, A.cc]);
      if (!past(d(day))) continue;
      add({
        kind: "expense",
        amount: a,
        account: acc,
        category: cat("Makanan & Minuman"),
        description: pick(["Makan siang", "Makan malam", "Kopi", "Sarapan", "Jajan"]),
        merchant: pick(FOOD),
        date: d(day),
        source: rnd() < 0.35 ? "telegram" : "web",
      });
      if (acc === A.cc) ccAdd(off, a);
    }

    // Transport: rides + fuel
    const rides = share(int(6, 10), 3);
    for (let i = 0; i < rides; i++) {
      const day = int(1, upTo);
      const a = amt(14_000, 58_000);
      if (!past(d(day))) continue;
      add({
        kind: "expense",
        amount: a,
        account: A.gopay,
        category: cat("Transportasi"),
        description: "Ojek online",
        merchant: "RideKita",
        date: d(day),
        source: rnd() < 0.3 ? "telegram" : "web",
      });
    }
    if (past(d(8)))
      add({
        kind: "expense",
        amount: amt(150_000, 260_000, 1000),
        account: A.cash,
        category: cat("Transportasi"),
        description: "Bensin",
        merchant: "SPBU Jalan Raya",
        date: d(8),
      });

    // Occasional: entertainment, health, education, shopping
    if (rnd() < 0.6 && past(d(19))) {
      const a = amt(90_000, 260_000, 1000);
      add({
        kind: "expense",
        amount: a,
        account: A.cc,
        category: cat("Hiburan"),
        description: pick(["Nonton bioskop", "Karaoke", "Tiket museum", "Bowling"]),
        merchant: pick(["Bioskop Layar Kita", "Karaoke Nada", "Galeri Kota"]),
        date: d(19),
      });
      ccAdd(off, a);
    }
    if (rnd() < 0.35 && past(d(16)))
      add({
        kind: "expense",
        amount: amt(65_000, 320_000, 1000),
        account: A.bca,
        category: cat("Kesehatan"),
        description: pick(["Apotek", "Konsultasi dokter", "Vitamin"]),
        merchant: pick(["Apotek Sehat Selalu", "Klinik Pratama Harapan"]),
        date: d(16),
      });
    if (rnd() < 0.2 && past(d(21)))
      add({
        kind: "expense",
        amount: amt(150_000, 450_000, 1000),
        account: A.bca,
        category: cat("Pendidikan"),
        description: pick(["Kursus online", "Buku"]),
        merchant: pick(["Akademi Daring", "Toko Buku Pena"]),
        date: d(21),
      });
    if (rnd() < 0.45 && past(d(23))) {
      const a = amt(180_000, 900_000, 1000);
      add({
        kind: "expense",
        amount: a,
        account: A.cc,
        category: cat("Belanja"),
        description: pick(["Baju", "Sepatu", "Peralatan rumah", "Gadget aksesoris"]),
        merchant: pick(["Toko Daring Serba Ada", "Mal Kota Baru", "Rumah Perabot"]),
        date: d(23),
      });
      ccAdd(off, a);
    }

    // Freelance income into Mandiri every other month
    if (off % 2 === 0 && past(d(18)))
      add({
        kind: "income",
        amount: amt(2_000_000, 4_500_000, 50_000),
        account: A.mandiri,
        category: cat("Freelance", "income"),
        description: "Proyek desain",
        merchant: "Klien Studio Kreatif",
        date: d(18),
      });

    // Monthly account fee (Mandiri, day 28) — marker identical to applyMonthlyFees()
    if (past(d(28)))
      add({
        kind: "expense",
        amount: 12_500,
        account: A.mandiri,
        category: cat("Biaya Admin"),
        description: "Biaya bulanan Mandiri Tabungan",
        merchant: "Mandiri Tabungan",
        date: d(28),
        notes: `[auto:monthly_fee:${A.mandiri}:${ym(off)}]`,
      });

    // Credit-card bill for last month (20th)
    const prev = ccSpend.get(off - 1) ?? 0;
    if (prev > 0 && past(d(20)))
      transfer({
        amount: Math.round(prev),
        account: A.bca,
        to: A.cc,
        description: "Bayar tagihan kartu kredit",
        date: d(20),
      });

    // Savings goals: deposits on the 26th as transfers BCA → Mandiri ([goal:<id>])
    if (off >= -11 && past(d(26))) {
      transfer({
        amount: 3_000_000,
        account: A.bca,
        to: A.mandiri,
        description: "Setor target Dana Darurat",
        notes: `[goal:${goals.emergency.id}]`,
        date: d(26),
      });
      goals.emergency.saved += 3_000_000;
    }
    if (off >= -7 && past(d(26))) {
      transfer({
        amount: 1_000_000,
        account: A.bca,
        to: A.mandiri,
        description: "Setor target Liburan Jepang",
        notes: `[goal:${goals.japan.id}]`,
        date: d(26),
      });
      goals.japan.saved += 1_000_000;
    }

    // USD investment: quarterly dividend + custody fee
    if (monthAt(off).m % 3 === 0 && past(d(15))) {
      add({
        kind: "income",
        amount: 14 + int(0, 900) / 100,
        currency: "USD",
        account: A.usd,
        category: cat("Dividen", "income"),
        description: "Dividen reksa dana",
        merchant: "Manajer Investasi Global",
        date: d(15),
      });
      add({
        kind: "expense",
        amount: 2.5,
        currency: "USD",
        account: A.usd,
        category: cat("Biaya Admin"),
        description: "Biaya kustodian",
        merchant: "Manajer Investasi Global",
        date: d(15),
      });
    }
  }

  // Bonus (THR) once, ~6 months ago
  add({
    kind: "income",
    amount: 18_500_000,
    account: A.bca,
    category: cat("Bonus", "income"),
    description: "THR",
    merchant: "PT Contoh Sejahtera",
    date: dateIn(-6, 24),
  });

  // Split transaction (one receipt → three categories), last month
  {
    const group = uuid();
    const date = dateIn(-1, 13);
    const parts = [
      [cat("Belanja"), "Kebutuhan rumah", groceryItems()],
      [
        cat("Kesehatan"),
        "Obat & vitamin",
        [
          { name: "Vitamin C 30 tab", qty: 1, price: 68_000 },
          { name: "Plester luka", qty: 2, price: 9_500 },
        ],
      ],
      [
        cat("Makanan & Minuman"),
        "Camilan",
        [
          { name: "Keripik singkong", qty: 2, price: 18_500 },
          { name: "Cokelat batang", qty: 3, price: 15_000 },
        ],
      ],
    ];
    parts.forEach(([category, note, items], i) =>
      add({
        kind: "expense",
        amount: itemsTotal(items),
        account: A.bca,
        category,
        description: `${note} (${i + 1}/${parts.length})`,
        merchant: "Supermarket Segar",
        date,
        items,
        source: "ocr",
        split_group: group,
      }),
    );
  }

  // Today: a couple of fresh entries so "today" never looks idle.
  add({
    kind: "expense",
    amount: 28_000,
    account: A.gopay,
    category: cat("Makanan & Minuman"),
    description: "Kopi pagi",
    merchant: "Kopi Senja",
    date: TODAY,
    source: "telegram",
  });
  add({
    kind: "expense",
    amount: 19_500,
    account: A.gopay,
    category: cat("Transportasi"),
    description: "Ojek online",
    merchant: "RideKita",
    date: TODAY,
  });

  // Current month showcase: Hiburan over 100%, Transportasi ~85% of budget
  const cur = (day) => dateIn(0, Math.min(day, TD));
  add({
    kind: "expense",
    amount: 475_000,
    account: A.cc,
    category: cat("Hiburan"),
    description: "Tiket konser",
    merchant: "Loket Acara Nusantara",
    date: cur(2),
  });
  ccAdd(0, 475_000);
  const BUDGET_TRANSPORT = 1_200_000;
  const transportNow = tx
    .filter((t) => t.category_id === cat("Transportasi") && t.occurred_at.startsWith(ym(0)))
    .reduce((s, t) => s + t.amount, 0);
  const top = Math.round(BUDGET_TRANSPORT * 0.85) - transportNow;
  if (top > 0)
    add({
      kind: "expense",
      amount: top,
      account: A.bca,
      category: cat("Transportasi"),
      description: "Servis motor & ganti oli",
      merchant: "Bengkel Maju Motor",
      date: cur(3),
    });

  /* ----- debts (+ installment payments as Cicilan & Hutang expenses) ----- */
  const debts = [];
  const debtPayments = [];
  const debt = (d, paidCount) => {
    const id = uuid();
    debts.push({ id, status: paidCount >= d.total_installments ? "paid_off" : "active", ...d });
    for (let n = 1; n <= paidCount; n++) {
      const [sy, sm] = d.start_date.split("-").map(Number);
      const off = (sy - TY) * 12 + (sm - TM) + (n - 1);
      const date = dateIn(off, d.due_day);
      if (!past(date)) break;
      const txId = add({
        kind: "expense",
        amount: d.installment_amount,
        account: d.account_id,
        category: cat("Cicilan & Hutang"),
        description: `Cicilan ${d.name} ke-${n}/${d.total_installments}`,
        merchant: d.provider,
        date,
      });
      debtPayments.push({
        id: uuid(),
        debt_id: id,
        installment_no: n,
        amount: d.installment_amount,
        paid_at: date,
        transaction_id: txId,
        created_at: ts(date, 10),
      });
    }
  };
  const dueBefore = (day) => (TD >= day ? 1 : 0); // this month's installment already paid?
  debt(
    {
      name: "Paylater Laptop",
      provider: "KrediCepat",
      kind: "paylater",
      currency: "IDR",
      total_amount: 9_000_000,
      installment_amount: 750_000,
      total_installments: 12,
      start_date: dateIn(-7, 10),
      due_day: 10,
      interest_rate: 2.95,
      account_id: A.bca,
      notes: null,
      created_at: ts(dateIn(-7, 1)),
    },
    7 + dueBefore(10),
  );
  debt(
    {
      name: "KTA Renovasi",
      provider: "Bank Sejahtera",
      kind: "loan",
      currency: "IDR",
      total_amount: 30_000_000,
      installment_amount: 1_350_000,
      total_installments: 24,
      start_date: dateIn(-5, 15),
      due_day: 15,
      interest_rate: 0.99,
      account_id: A.bca,
      notes: "Bunga flat per bulan",
      created_at: ts(dateIn(-5, 1)),
    },
    5 + dueBefore(15),
  );
  debt(
    {
      name: "Cicilan Ponsel",
      provider: "Toko Gawai Prima",
      kind: "credit_card",
      currency: "IDR",
      total_amount: 5_400_000,
      installment_amount: 900_000,
      total_installments: 6,
      start_date: dateIn(-13, 5),
      due_day: 5,
      interest_rate: 0,
      account_id: A.bca,
      notes: "Cicilan 0%",
      created_at: ts(dateIn(-13, 1)),
    },
    6,
  );

  /* ----- receivables (linked Piutang expense/income transactions) ----- */
  const receivables = [];
  const recPayments = [];
  const receivable = (r, pays) => {
    const id = uuid();
    const txId = r.account_id
      ? add({
          kind: "expense",
          amount: r.amount,
          account: r.account_id,
          category: cat("Piutang"),
          description: `Pinjaman ke ${r.borrower}`,
          date: r.lent_at,
          notes: r.notes,
        })
      : null;
    let paid = 0;
    for (const [amount, date] of pays) {
      if (!past(date)) continue;
      paid += amount;
      const pTx = add({
        kind: "income",
        amount,
        account: r.account_id,
        category: cat("Piutang", "income"),
        description: `Pembayaran piutang ${r.borrower}`,
        date,
      });
      recPayments.push({
        id: uuid(),
        receivable_id: id,
        amount,
        paid_at: date,
        account_id: r.account_id,
        transaction_id: pTx,
        created_at: ts(date, 12),
      });
    }
    receivables.push({
      id,
      currency: "IDR",
      transaction_id: txId,
      status: paid >= r.amount ? "paid" : "active",
      created_at: ts(r.lent_at, 11),
      ...r,
    });
  };
  receivable(
    {
      name: "Pinjaman modal usaha",
      borrower: "Raka Pratama",
      amount: 3_000_000,
      lent_at: dateIn(-4, 9),
      due_date: dateIn(1, 30),
      account_id: A.bca,
      notes: "Dicicil tiap bulan",
    },
    [
      [1_000_000, dateIn(-2, 27)],
      [750_000, dateIn(-1, 27)],
    ],
  );
  receivable(
    {
      name: "Talangan tiket konser",
      borrower: "Dina Lestari",
      amount: 850_000,
      lent_at: dateIn(-3, 4),
      due_date: dateIn(-2, 4),
      account_id: A.bca,
      notes: null,
    },
    [[850_000, dateIn(-3, 20)]],
  );
  receivable(
    {
      name: "Patungan kado kantor",
      borrower: "Bimo Saputra",
      amount: 250_000,
      lent_at: dateIn(-1, 22),
      due_date: dateIn(0, 28),
      account_id: null,
      notes: "Belum ditagih",
    },
    [],
  );

  /* ----- gold (Antam) purchases with linked "Emas" transactions ----- */
  const gold = [];
  const goldRow = (g) => {
    const txId = add({
      kind: g.kind === "buy" ? "expense" : "income",
      amount: g.total,
      account: A.bca,
      category: cat("Emas", g.kind === "buy" ? "expense" : "income"),
      description: `${g.kind === "buy" ? "Beli" : "Jual"} emas ${g.grams} g${g.place ? ` · ${g.place}` : ""}`,
      date: g.occurred_at,
      notes: g.notes,
    });
    gold.push({
      id: uuid(),
      account_id: A.bca,
      transaction_id: txId,
      gold_type: "Antam",
      created_at: ts(g.occurred_at, 13),
      ...g,
    });
  };
  for (const [off, day, grams, ppg, kind, num] of [
    [-12, 8, 2, 1_465_000, "buy", "AB 104233"],
    [-9, 12, 1, 1_548_000, "buy", "AC 220917"],
    [-6, 3, 5, 1_689_000, "buy", "AD 381245"],
    [-4, 21, 1, 1_735_000, "sell", null],
    [-3, 17, 2, 1_812_000, "buy", "AE 503318"],
    [-1, 6, 1, 1_905_000, "buy", "AF 618804"],
  ])
    goldRow({
      kind,
      occurred_at: dateIn(off, day),
      grams,
      price_per_gram: ppg,
      total: grams * ppg,
      place: kind === "buy" ? "Butik Emas Kota" : "Toko Emas Cahaya",
      notes: kind === "buy" ? "Sertifikat Antam" : "Jual sebagian untuk renovasi",
      product_number: num,
    });
  const goldPrices = [
    { price_date: TODAY, source: "antam", buy: 1_968_000, buyback: 1_812_000, estimated: false },
    { price_date: TODAY, source: "world", buy: 1_742_000, buyback: 1_742_000, estimated: false },
    {
      price_date: addDays(TODAY, -1),
      source: "antam",
      buy: 1_961_000,
      buyback: 1_805_000,
      estimated: false,
    },
    {
      price_date: addDays(TODAY, -1),
      source: "world",
      buy: 1_738_000,
      buyback: 1_738_000,
      estimated: false,
    },
  ].map((g) => ({ ...g, fetched_at: ts(g.price_date, 8) }));

  /* ----- insert transactions & dependants ----- */
  tx.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  await insert("transactions", tx);
  await insert("debts", debts);
  await insert("debt_payments", debtPayments);
  await insert("receivables", receivables);
  await insert("receivable_payments", recPayments);
  await insert("gold_purchases", gold);
  await insert("gold_prices", goldPrices);
  await insert(
    "fx_rates",
    [...fx].map(([rate_date, r]) => ({ rate_date, base: "USD", quote: "IDR", rate: r })),
  );

  /* ----- subscriptions ----- */
  const nextDay = (day) => (TD < day ? dateIn(0, day) : dateIn(1, day));
  await insert("subscriptions", [
    {
      name: "Netflix",
      amount: 186_000,
      currency: "IDR",
      cycle: "monthly",
      next_due: nextDay(3),
      account_id: A.cc,
      category_id: cat("Langganan"),
      active: true,
    },
    {
      name: "Spotify",
      amount: 64_990,
      currency: "IDR",
      cycle: "monthly",
      next_due: nextDay(11),
      account_id: A.cc,
      category_id: cat("Langganan"),
      active: true,
    },
    {
      name: "iCloud+",
      amount: 49_000,
      currency: "IDR",
      cycle: "monthly",
      next_due: nextDay(17),
      account_id: A.cc,
      category_id: cat("Langganan"),
      active: true,
      tax_percent: 11,
      notes: "200 GB, termasuk PPN",
    },
    {
      name: "Domain & hosting",
      amount: 24,
      currency: "USD",
      cycle: "yearly",
      next_due: dateIn(2, 12),
      account_id: A.cc,
      category_id: cat("Langganan"),
      active: true,
    },
    {
      name: "Gym Sehat Bugar",
      amount: 350_000,
      currency: "IDR",
      cycle: "monthly",
      next_due: dateIn(-2, 1),
      account_id: A.bca,
      category_id: cat("Kesehatan"),
      active: false,
      notes: "Dijeda",
    },
  ]);

  /* ----- budgets (some rollover) & alert log ----- */
  const B = {
    food: uuid(),
    shop: uuid(),
    trans: uuid(),
    fun: uuid(),
    subs: uuid(),
    bills: uuid(),
  };
  const bCreated = ts(dateIn(-6, 1), 8);
  await insert("budgets", [
    {
      id: B.food,
      category_id: cat("Makanan & Minuman"),
      amount: 1_200_000,
      alert_percent: 80,
      rollover: true,
      created_at: bCreated,
    },
    {
      id: B.shop,
      category_id: cat("Belanja"),
      amount: 2_500_000,
      alert_percent: 80,
      rollover: false,
      created_at: bCreated,
    },
    {
      id: B.trans,
      category_id: cat("Transportasi"),
      amount: BUDGET_TRANSPORT,
      alert_percent: 80,
      rollover: false,
      created_at: bCreated,
    },
    {
      id: B.fun,
      category_id: cat("Hiburan"),
      amount: 400_000,
      alert_percent: 80,
      rollover: false,
      created_at: bCreated,
    },
    {
      id: B.subs,
      category_id: cat("Langganan"),
      amount: 350_000,
      alert_percent: 90,
      rollover: true,
      created_at: bCreated,
    },
    {
      id: B.bills,
      category_id: cat("Tagihan & Utilitas"),
      amount: 1_400_000,
      alert_percent: 80,
      rollover: false,
      created_at: bCreated,
    },
  ]);
  await insert("budget_alerts", [
    { budget_id: B.trans, month: ym(0), level: 80, created_at: ts(cur(3), 18) },
    { budget_id: B.fun, month: ym(0), level: 80, created_at: ts(cur(2), 20) },
    { budget_id: B.fun, month: ym(0), level: 100, created_at: ts(cur(2), 20, 1) },
  ]);

  /* ----- goals (linked to Mandiri; deposits are the [goal:id] transfers above) ----- */
  await insert("goals", [
    {
      id: goals.emergency.id,
      name: "Dana Darurat",
      target_amount: 60_000_000,
      saved_amount: goals.emergency.saved,
      deadline: dateIn(9, 30),
      color: "#2f7d5b",
      account_id: A.mandiri,
      created_at: ts(dateIn(-11, 1)),
    },
    {
      id: goals.japan.id,
      name: "Liburan Jepang",
      target_amount: 35_000_000,
      saved_amount: goals.japan.saved,
      deadline: dateIn(5, 1),
      color: "#b85c5c",
      account_id: A.mandiri,
      created_at: ts(dateIn(-7, 1)),
    },
    {
      id: uuid(),
      name: "Laptop Baru",
      target_amount: 15_000_000,
      saved_amount: 15_000_000,
      deadline: null,
      color: "#5b7fa6",
      account_id: null,
      created_at: ts(dateIn(-13, 2)),
    },
  ]);

  /* ----- recurring transactions (next_due after the last posted occurrence) ----- */
  await insert("recurring_transactions", [
    {
      id: R.salary,
      name: "Gaji",
      kind: "income",
      amount: 18_500_000,
      account_id: A.bca,
      category_id: cat("Gaji", "income"),
      description: "Gaji bulanan",
      merchant: "PT Contoh Sejahtera",
      cycle: "monthly",
      day_of_month: 25,
      start_date: dateIn(-(MONTHS - 1), 25),
      next_due: TD >= 25 ? dateIn(1, 25) : dateIn(0, 25),
      auto_post: true,
      active: true,
    },
    {
      id: R.rent,
      name: "Sewa apartemen",
      kind: "expense",
      amount: 3_800_000,
      account_id: A.bca,
      category_id: cat("Sewa & Rumah"),
      description: "Sewa apartemen",
      merchant: "Apartemen Taman Melati",
      cycle: "monthly",
      day_of_month: 1,
      start_date: dateIn(-(MONTHS - 1), 1),
      next_due: dateIn(1, 1),
      auto_post: true,
      active: true,
    },
    {
      id: R.topup,
      name: "Top up GoPay",
      kind: "transfer",
      amount: 750_000,
      account_id: A.bca,
      to_account_id: A.gopay,
      description: "Top up GoPay",
      cycle: "monthly",
      day_of_month: 2,
      start_date: dateIn(-(MONTHS - 1), 2),
      next_due: TD >= 2 ? dateIn(1, 2) : dateIn(0, 2),
      auto_post: true,
      active: true,
    },
    {
      id: R.trash,
      name: "Iuran kebersihan",
      kind: "expense",
      amount: 50_000,
      account_id: A.cash,
      category_id: cat("Tagihan & Utilitas"),
      description: "Iuran kebersihan RT",
      cycle: "monthly",
      day_of_month: 10,
      start_date: dateIn(0, 10),
      next_due: nextDay(10),
      auto_post: false,
      active: true,
    },
  ]);

  /* ----- reconciliation checkpoints ----- */
  const balanceAt = (accId, date) => {
    const a = accounts.find((x) => x.id === accId);
    let b = a.initial_balance;
    for (const t of tx) {
      if (t.occurred_at > date) continue;
      if (t.account_id === accId && t.kind === "income") b += t.amount;
      else if (t.account_id === accId) b -= t.amount;
      else if (t.to_account_id === accId && t.kind === "transfer") b += t.amount;
    }
    return Math.round(b * 100) / 100;
  };
  const eoLast = dateIn(-1, 31);
  const eoPrev = dateIn(-2, 31);
  const bcaBal = balanceAt(A.bca, eoLast);
  const mdrBal = balanceAt(A.mandiri, eoPrev);
  await insert("account_reconciliations", [
    {
      account_id: A.mandiri,
      as_of: eoPrev,
      statement_balance: mdrBal - 12_500,
      app_balance: mdrBal,
      created_at: ts(dateIn(-1, 2), 20),
    },
    {
      account_id: A.bca,
      as_of: eoLast,
      statement_balance: bcaBal,
      app_balance: bcaBal,
      created_at: ts(cur(1), 21),
    },
  ]);

  /* ----- activity log (recent days) ----- */
  const recentTx = tx.filter((t) => t.occurred_at <= TODAY).slice(-14);
  const log = recentTx.map((t, i) => ({
    action: "transaction.create",
    entity: "transactions",
    detail: {
      kind: t.kind,
      amount: t.amount,
      currency: t.currency,
      description: t.description,
      source: t.source,
    },
    created_at: ts(t.occurred_at, 19, 10 + i),
  }));
  log.push(
    {
      action: "auth.login",
      entity: "auth",
      detail: { name: "demo" },
      created_at: ts(TODAY, 7, 30),
    },
    {
      action: "goal.funds",
      entity: "goals",
      detail: {
        name: "Dana Darurat",
        amount: 3_000_000,
        currency: "IDR",
        direction: "deposit",
        from: "BCA",
        to: "Mandiri Tabungan",
      },
      created_at: ts(dateIn(-1, 26), 20),
    },
    {
      action: "debt.pay",
      entity: "debts",
      detail: { name: "KTA Renovasi", amount: 1_350_000, currency: "IDR", installment: 5 },
      created_at: ts(dateIn(-1, 15), 9),
    },
    {
      action: "receivable.pay",
      entity: "receivables",
      detail: { name: "Pinjaman modal usaha", amount: 750_000, currency: "IDR" },
      created_at: ts(dateIn(-1, 27), 18),
    },
    {
      action: "account.reconcile",
      entity: "accounts",
      detail: { name: "BCA", amount: bcaBal, currency: "IDR" },
      created_at: ts(cur(1), 21),
    },
    {
      action: "recurring.post",
      entity: "recurring_transactions",
      detail: { name: "Sewa apartemen", amount: 3_800_000, currency: "IDR" },
      created_at: ts(cur(1), 7),
    },
    {
      action: "transaction.split",
      entity: "transactions",
      detail: { name: "Supermarket Segar", rows: 3 },
      created_at: ts(dateIn(-1, 13), 19),
    },
    {
      action: "gold_purchases.create",
      entity: "gold_purchases",
      detail: { name: "Antam 1 g", amount: 1_905_000, currency: "IDR" },
      created_at: ts(dateIn(-1, 6), 14),
    },
    {
      action: "backup.export",
      entity: "backup",
      detail: { rows: tx.length },
      created_at: ts(dateIn(-1, 30), 22),
    },
  );
  await insert("activity_log", log);

  /* ----- summary ----- */
  const bal = Object.fromEntries(accounts.map((a) => [a.name, balanceAt(a.id, TODAY)]));
  console.log(`Seeded demo data for today=${TODAY}:`);
  console.log(
    `  ${tx.length} transactions, ${debts.length} debts, ${gold.length} gold rows, ${receivables.length} receivables`,
  );
  for (const [n, b] of Object.entries(bal))
    console.log(`  ${n.padEnd(16)} ${b.toLocaleString("id-ID")}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
