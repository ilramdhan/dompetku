/** Telegram/n8n bot: drafts with confirm buttons, reports and lists. Shared business logic stays in finance.server. */
import { db } from "./db.server";
import {
  aiTextGate,
  clampMessage,
  guessCategory,
  matchCategory,
  money,
  parseCallback,
  pickerKeyboard,
  previewKeyboard,
  previousRange,
  previewText,
  quickParse,
  resolvePeriod,
  undoKeyboard,
  type DraftPayload,
  type InlineKeyboard,
} from "./bot";
import { addDays } from "./dates";
import type { Tables } from "./database.types";
import { withTax } from "./fees";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fin = () => import("./finance.server");
type TxKind = Tables<"transactions">["kind"];
const DRAFT_TTL_HOURS = 48;
const BOT_SOURCES = ["telegram", "whatsapp", "ocr"];

export type BotUpdate = {
  update_id: number;
  chat_id: string;
  text?: string | null | undefined;
  image_base64?: string | null | undefined;
  mime_type?: string | null | undefined;
  callback_data?: string | null | undefined;
};
export type BotReply = {
  method: "send" | "edit" | "none";
  text: string;
  reply_markup: InlineKeyboard | null;
  toast?: string;
};

const reply = (text: string, reply_markup: InlineKeyboard | null = null): BotReply => ({
  method: "send",
  text: clampMessage(text),
  reply_markup,
});
const edit = (
  text: string,
  reply_markup: InlineKeyboard | null = null,
  toast?: string,
): BotReply => ({
  method: "edit",
  text: clampMessage(text),
  reply_markup,
  ...(toast ? { toast } : {}),
});

/**
 * Required server-side allow-list (defense in depth on top of the n8n filter). Fails closed:
 * an empty or unset BOT_ALLOWED_CHAT_IDS refuses every chat.
 */
export function chatAllowed(chatId: string): boolean {
  const list = (process.env["BOT_ALLOWED_CHAT_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 && list.includes(String(chatId));
}

/* ---------------- Entry point ---------------- */
export async function handleBotUpdate(u: BotUpdate): Promise<BotReply> {
  if (!chatAllowed(u.chat_id)) {
    // Refuse before any DB access; echo the chat_id so the owner can add it to the env.
    console.warn(`bot: chat_id ${u.chat_id} ditolak (tidak ada di BOT_ALLOWED_CHAT_IDS)`);
    return reply(
      `⛔ Bot belum dikonfigurasi: tambahkan chat_id ${u.chat_id} ke BOT_ALLOWED_CHAT_IDS.`,
    );
  }
  if (u.callback_data) return handleCallback(u.callback_data, String(u.chat_id));
  if (u.image_base64) return draftFromImage(u);
  const text = (u.text ?? "").trim();
  if (!text)
    return reply(
      'Kirim teks transaksi (mis. "kopi 25rb") atau foto struk. Ketik /help untuk bantuan.',
    );
  const { classifyBotCommand } = await import("./bot");
  if (text.startsWith("/") || classifyBotCommand(text).type !== "unknown") {
    const r = await (await fin()).botCommand(text);
    return reply(r.message);
  }
  return draftFromText(u, text);
}

/* ---------------- Drafts ---------------- */
/**
 * Idempotency key of a bot_drafts row. update_id is only unique per bot, so the chat is part of
 * the key: two chats can never collide on (or read back) each other's draft.
 */
export const draftKey = (chatId: string, updateId: number) => `tg:${chatId}:${updateId}`;

type DraftRow = {
  id: string;
  chat_id: string;
  status: string;
  payload: DraftPayload;
  receipt_path: string | null;
  transaction_id: string | null;
  created_at: string;
  source: string;
};

async function defaultAccountName(): Promise<string | null> {
  const id = await (await fin()).defaultAccountId();
  if (!id) return null;
  return (
    ((await db().from("accounts").select("name").eq("id", id).maybeSingle()).data
      ?.name as string) ?? null
  );
}

const DRAFTS_MISSING = "Tabel bot_drafts belum ada. Jalankan bagian v7 di supabase/schema.sql.";

/** A missing bot_drafts table (schema v7 not run) reads as "no draft"; other errors surface. */
async function existingDraft(externalId: string): Promise<DraftRow | null> {
  const r = await db().from("bot_drafts").select("*").eq("external_id", externalId).maybeSingle();
  if (r.error) {
    if ((await fin()).isMissingTable(r.error)) return null;
    throw new Error(r.error.message);
  }
  return (r.data as unknown as DraftRow | null) ?? null;
}

async function storeDraft(
  externalId: string,
  chatId: string,
  payload: DraftPayload,
  source: "telegram" | "whatsapp" | "ocr",
  receiptPath: string | null,
): Promise<DraftRow> {
  const res = await db()
    .from("bot_drafts")
    .insert({
      external_id: externalId,
      chat_id: chatId,
      payload,
      source,
      receipt_path: receiptPath,
      status: "pending",
    })
    .select("*")
    .single();
  if (res.error) {
    if (/duplicate key|23505/i.test(res.error.message)) {
      const again = await existingDraft(externalId);
      if (again) return again;
    }
    if ((await fin()).isMissingTable(res.error)) throw new Error(DRAFTS_MISSING);
    throw new Error(res.error.message);
  }
  // Opportunistic cleanup of old drafts (cheap, indexed). Keep them longer than the 7-day undo
  // window plus the 48 h draft TTL, because the ↩️ Undo button is validated against this table.
  void db()
    .from("bot_drafts")
    .delete()
    .lt("created_at", new Date(Date.now() - 10 * 86400000).toISOString())
    .then(() => undefined);
  return res.data as unknown as DraftRow;
}

async function previewReply(row: DraftRow, asEdit = false): Promise<BotReply> {
  const text = previewText(row.payload, await defaultAccountName());
  return asEdit ? edit(text, previewKeyboard(row.id)) : reply(text, previewKeyboard(row.id));
}

/** Zero-token category guess from what the user filed before under the same description. */
async function historyCategory(description: string, kind: string): Promise<string | null> {
  if (description.length < 3) return null;
  const r = await db()
    .from("transactions")
    .select("category:categories(name)")
    .eq("kind", kind as TxKind)
    .ilike("description", description.replace(/[%_]/g, ""))
    .not("category_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((r.data as any)?.category?.name as string) ?? null;
}

const NO_AMOUNT =
  '❓ Nominal tidak terbaca. Contoh: "kopi 25rb", "gaji 8jt ke BCA", atau kirim foto struk. Ketik /help untuk perintah.';
const TOO_LONG =
  '✂️ Pesan terlalu panjang untuk dibaca AI (maks. 300 karakter). Pakai format singkat seperti "kopi 25rb", atau kirim foto struk.';
const AI_QUOTA =
  '⏳ Kuota AI harian untuk chat ini sudah habis. Pakai format singkat seperti "kopi 25rb" (tanpa AI). Foto struk baru bisa dibaca lagi besok.';
const aiUsage = () => import("./ai-usage.server");

async function draftFromText(u: BotUpdate, text: string): Promise<BotReply> {
  const externalId = draftKey(u.chat_id, u.update_id);
  const prev = await existingDraft(externalId);
  if (prev) return previewReply(prev);
  const f = await fin();
  const ctx = await f.parseContext();
  const today = f.today();
  const mode = (process.env["BOT_TEXT_AI"] ?? "auto").toLowerCase(); // auto | always | never
  const q = mode === "always" ? null : quickParse(text, today, ctx.accounts ?? []);
  let payload: DraftPayload | null = null;
  if (q) {
    const list = q.kind === "income" ? ctx.income : ctx.expense;
    const category =
      guessCategory(`${q.description} ${text}`, list) ??
      matchCategory(await historyCategory(q.description, q.kind), list) ??
      matchCategory("Lainnya", list);
    payload = {
      kind: q.kind,
      amount: q.amount,
      currency: q.currency,
      category,
      account: q.account,
      description: q.description || category,
      merchant: null,
      date: q.date,
      items: [],
      via: "quick",
    };
  } else if (mode !== "never") {
    // Token guard: never spend AI on chat without any amount signal or on over-long text.
    const gate = aiTextGate(text);
    if (!gate.ok) return reply(gate.reason === "too_long" ? TOO_LONG : NO_AMOUNT);
    if (await (await aiUsage()).botAiQuotaReached(u.chat_id)) return reply(AI_QUOTA);
    const { parseText } = await import("./ocr.server");
    const d = await parseText(text, ctx, today, { source: "bot", chatId: u.chat_id });
    if (d.amount > 0)
      payload = {
        kind: d.kind,
        amount: d.amount,
        currency: d.currency,
        category: d.category,
        account: d.account ?? null,
        description: d.description ?? text.slice(0, 200),
        merchant: d.merchant,
        date: d.date ?? today,
        items: d.items,
        via: "ai",
      };
  }
  if (!payload) return reply(NO_AMOUNT);
  return previewReply(await storeDraft(externalId, u.chat_id, payload, "telegram", null));
}

async function draftFromImage(u: BotUpdate): Promise<BotReply> {
  const externalId = draftKey(u.chat_id, u.update_id);
  const prev = await existingDraft(externalId);
  if (prev) return previewReply(prev);
  const mime = /^image\/(jpeg|png|webp)$/.test(u.mime_type ?? "") ? u.mime_type! : "image/jpeg";
  const b64 = u.image_base64!.replace(/^data:[^,]+,/, "");
  const dataUrl = `data:${mime};base64,${b64}`;
  if (await (await aiUsage()).botAiQuotaReached(u.chat_id)) return reply(AI_QUOTA);
  const f = await fin();
  const ctx = await f.parseContext();
  const { parseReceipt } = await import("./ocr.server");
  const d = await parseReceipt(dataUrl, ctx, { source: "bot", chatId: u.chat_id });
  if (!(d.amount > 0))
    return reply("❓ Total nota tidak terbaca. Coba foto lebih dekat, terang, dan tidak miring.");
  // Caption can name the account: foto + caption "pakai BCA".
  const capAcc = u.text
    ? (quickParse(`${u.text} 1000`, f.today(), ctx.accounts ?? [])?.account ?? null)
    : null;
  let receiptPath: string | null = null;
  try {
    receiptPath = (await (await import("./receipt.server")).uploadReceipt(dataUrl)).path;
  } catch (e) {
    console.error("receipt upload failed", e);
  }
  const payload: DraftPayload = {
    kind: d.kind,
    amount: d.amount,
    currency: d.currency,
    category: d.category,
    account: capAcc ?? d.account ?? null,
    description: d.description ?? d.merchant,
    merchant: d.merchant,
    date: d.date ?? f.today(),
    items: d.items.slice(0, 50),
    via: "ocr",
  };
  return previewReply(await storeDraft(externalId, u.chat_id, payload, "ocr", receiptPath));
}

/* ---------------- Callback buttons ---------------- */
async function handleCallback(data: string, chatId: string): Promise<BotReply> {
  const cb = parseCallback(data);
  if (!cb) return edit("⚠️ Tombol tidak dikenali.", null, "Tidak dikenali");
  if (cb.kind === "undo") {
    // Undo buttons are only ever attached to drafts saved through the bot; refuse any other id
    // (callback_data can be forged by a modified Telegram client).
    const link = await db()
      .from("bot_drafts")
      .select("id")
      .eq("transaction_id", cb.id)
      .eq("chat_id", chatId)
      .limit(1)
      .maybeSingle();
    if (link.error && !(await fin()).isMissingTable(link.error))
      throw new Error(link.error.message);
    if (!link.data)
      return edit("⚠️ Hanya transaksi yang disimpan lewat bot yang bisa di-undo.", null, "Gagal");
    const r = await undoTransaction(cb.id);
    return edit(r.message, null, r.ok ? "Dibatalkan" : "Gagal");
  }
  const found = await db().from("bot_drafts").select("*").eq("id", cb.id).maybeSingle();
  if (found.error) {
    if ((await fin()).isMissingTable(found.error)) return edit(`⚠️ ${DRAFTS_MISSING}`, null);
    throw new Error(found.error.message);
  }
  const row = found.data as DraftRow | null;
  // A draft belongs to the chat it was created in; never act on another chat's draft.
  if (!row || String(row.chat_id) !== chatId) return edit("⚠️ Pratinjau tidak ditemukan.", null);
  if (row.status === "saved")
    return edit(
      "✅ Sudah tersimpan sebelumnya.",
      row.transaction_id ? undoKeyboard(row.transaction_id) : null,
      "Sudah tersimpan",
    );
  if (row.status !== "pending")
    return edit(
      row.status === "cancelled" ? "❌ Dibatalkan." : "↩️ Transaksi sudah di-undo.",
      null,
    );
  if (Date.parse(row.created_at) < Date.now() - DRAFT_TTL_HOURS * 3600_000) {
    await db().from("bot_drafts").update({ status: "cancelled" }).eq("id", row.id);
    return edit("⌛ Pratinjau kedaluwarsa, kirim ulang transaksinya.", null);
  }
  const f = await fin();
  const ctx = await f.parseContext();
  const p = row.payload;
  const catList = p.kind === "income" ? ctx.income : ctx.expense;
  const accList = ctx.accounts ?? [];
  const update = async (patch: Partial<DraftPayload>) => {
    const payload = { ...p, ...patch };
    await db()
      .from("bot_drafts")
      .update({ payload, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending");
    return previewReply({ ...row, payload }, true);
  };
  switch (cb.op) {
    case "s":
      return saveDraft(row);
    case "x": {
      // Only a still-pending draft may be cancelled: a racing ✅ must not lose its receipt photo.
      const c = await db()
        .from("bot_drafts")
        .update({ status: "cancelled" })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (!c.error && !(c.data ?? []).length) return edit("ℹ️ Pratinjau ini sudah diproses.", null);
      if (row.receipt_path)
        await (await import("./receipt.server")).removeReceipt(row.receipt_path);
      return edit("❌ Dibatalkan, tidak ada yang disimpan.", null, "Dibatalkan");
    }
    case "b":
      return previewReply(row, true);
    case "k": {
      const kind = p.kind === "income" ? "expense" : "income";
      const list = kind === "income" ? ctx.income : ctx.expense;
      return update({
        kind,
        category: matchCategory(p.category, list) ?? matchCategory("Lainnya", list),
      });
    }
    case "c":
      return edit(
        `🏷 Pilih kategori ${p.kind === "income" ? "pemasukan" : "pengeluaran"}:`,
        pickerKeyboard(row.id, "C", catList),
      );
    case "a":
      return edit("🏦 Pilih akun:", pickerKeyboard(row.id, "A", accList));
    case "C": {
      const c = cb.idx != null ? catList[cb.idx] : undefined;
      return c ? update({ category: c }) : previewReply(row, true);
    }
    case "A": {
      const a = cb.idx != null ? accList[cb.idx] : undefined;
      return a ? update({ account: a }) : previewReply(row, true);
    }
  }
}

async function saveDraft(row: DraftRow): Promise<BotReply> {
  const p = row.payload;
  const f = await fin();
  const r = await f.createFromExternal({
    kind: p.kind,
    amount: p.amount,
    currency: p.currency,
    category: p.category,
    account: p.account,
    to_account: null,
    description: p.description,
    merchant: p.merchant,
    date: p.date,
    source: row.source === "ocr" ? "ocr" : "telegram",
    items: p.items.length ? p.items : null,
    notes: null,
    raw: { via: p.via, draft_id: row.id },
    external_id: `draft:${row.id}`,
    receipt_path: row.receipt_path,
  });
  await db()
    .from("bot_drafts")
    .update({ status: "saved", transaction_id: r.transaction.id })
    .eq("id", row.id);
  const acc = r.transaction.account_id
    ? (await db().from("accounts").select("name").eq("id", r.transaction.account_id).maybeSingle())
        .data?.name
    : null;
  // v11: append budget threshold alerts (never throws; "" when none or on failure).
  const { budgetAlertsFor, budgetAlertLines } = await import("./budget.server");
  const alerts = r.duplicate ? "" : budgetAlertLines(await budgetAlertsFor(r.transaction));
  return edit(
    `${r.message}${acc ? ` • ${acc}` : ""}${alerts}`,
    undoKeyboard(r.transaction.id),
    "Tersimpan",
  );
}

/* ---------------- Undo ---------------- */
/**
 * Created by the bot/n8n? source "ocr" is shared with the web receipt scanner, so an ocr row
 * only counts when it carries the bot's idempotency key or n8n's raw payload.
 */
export function isBotTransaction(tx: {
  source?: string | null;
  external_id?: string | null;
  raw?: unknown;
  notes?: string | null;
}): boolean {
  if (tx.notes?.startsWith("[fee:")) return false;
  if (tx.source === "telegram" || tx.source === "whatsapp") return true;
  if (tx.source !== "ocr") return false;
  const raw = (tx.raw ?? null) as { ocr?: unknown; draft_id?: unknown } | null;
  return !!tx.external_id?.startsWith("draft:") || !!raw?.ocr || !!raw?.draft_id;
}

export async function undoTransaction(id: string): Promise<{ ok: boolean; message: string }> {
  const tx = (
    await db()
      .from("transactions")
      .select("*") // "*" so it still works before v7 adds external_id
      .eq("id", id)
      .maybeSingle()
  ).data as any;
  if (!tx) return { ok: false, message: "⚠️ Transaksi tidak ditemukan (mungkin sudah dihapus)." };
  if (!isBotTransaction(tx))
    return {
      ok: false,
      message: "⚠️ Hanya transaksi dari bot yang bisa di-undo. Hapus lewat web.",
    };
  if (Date.parse(tx.created_at) < Date.now() - 7 * 86400000)
    return { ok: false, message: "⚠️ Undo hanya untuk transaksi ≤ 7 hari. Hapus lewat web." };
  await db().from("transactions").delete().like("notes", `[fee:${tx.id}]`);
  const del = await db().from("transactions").delete().eq("id", tx.id);
  if (del.error) return { ok: false, message: `⚠️ Gagal undo: ${del.error.message}` };
  // All photos (receipt_paths, v12) — only those no other transaction (e.g. a split sibling made
  // on the web) still references. Undo removes just this row, never its whole split group.
  await (await import("./split.server")).removeOrphanPhotos([tx], [tx.id]);
  await db().from("bot_drafts").update({ status: "undone" }).eq("transaction_id", tx.id);
  const f = await fin();
  await f.logActivity("transaction.delete", "transactions", {
    amount: Number(tx.amount),
    currency: tx.currency,
    description: tx.description,
    source: "bot-undo",
  });
  return {
    ok: true,
    message: `↩️ Dihapus: ${tx.description ?? "transaksi"} ${money(Number(tx.amount), tx.currency)}`,
  };
}

export async function undoLast(): Promise<{ ok: boolean; message: string }> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  // Filter fee rows in JS: SQL `notes NOT LIKE ...` is NULL (→ excluded) for the usual notes = null.
  const r = await db()
    .from("transactions")
    .select("*")
    .in("source", BOT_SOURCES)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  const last = ((r.data ?? []) as any[]).find(isBotTransaction);
  if (!last) return { ok: false, message: "Tidak ada transaksi dari bot dalam 24 jam terakhir." };
  return undoTransaction(last.id as string);
}

/* ---------------- Reports & lists ---------------- */
type TxLite = {
  kind: string;
  amount_idr: number;
  occurred_at: string;
  description: string | null;
  merchant: string | null;
  category: { name: string } | null;
};

/** PostgREST caps a response at 1000 rows by default; page through it, up to a hard cap. */
export const TX_PAGE_SIZE = 1000;
export const TX_HARD_CAP = 50_000;
export const TRUNCATED_NOTE =
  "⚠️ (data terpotong) Terlalu banyak transaksi; total di atas tidak lengkap, lihat di web.";

/** Transactions in [start, end) newest first, with `truncated` when the hard cap was hit. */
async function txIn(
  start: string,
  end: string,
  kind?: string,
): Promise<{ rows: TxLite[]; truncated: boolean }> {
  const page = (from: number, to: number) => {
    let q = db()
      .from("transactions")
      .select("kind, amount_idr, occurred_at, description, merchant, category:categories(name)")
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .neq("kind", "transfer");
    if (kind) q = q.eq("kind", kind as TxKind);
    // Tie-break on id so pages are stable when many rows share a date.
    return q.order("occurred_at", { ascending: false }).order("id").range(from, to);
  };
  const rows: TxLite[] = [];
  for (let from = 0; from < TX_HARD_CAP; from += TX_PAGE_SIZE) {
    const r = await page(from, Math.min(from + TX_PAGE_SIZE, TX_HARD_CAP) - 1);
    if (r.error) throw new Error(r.error.message);
    const batch = (r.data ?? []) as any[];
    for (const t of batch) rows.push({ ...t, amount_idr: Number(t.amount_idr) });
    if (batch.length < TX_PAGE_SIZE) return { rows, truncated: false };
  }
  // Exactly at the cap: probe one more row to tell "complete" from "cut off".
  const more = await page(TX_HARD_CAP, TX_HARD_CAP);
  if (more.error) throw new Error(more.error.message);
  return { rows, truncated: (more.data ?? []).length > 0 };
}

const idr = (n: number) => money(n, "IDR");
const shortDay = (d: string) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(d + "T00:00:00Z"),
  );

export async function reportData(spec: string) {
  const f = await fin();
  const today = f.today();
  const p = resolvePeriod(spec, today);
  if (!p) return null;
  await f.applyMonthlyFees();
  await f.applyRecurringLazy();
  const prev = previousRange(p);
  const [cur, prevRes] = await Promise.all([
    txIn(p.start, p.end),
    txIn(prev.start, prev.end, "expense"),
  ]);
  const rows = cur.rows;
  const prevRows = prevRes.rows;
  const income = rows.filter((t) => t.kind === "income").reduce((a, t) => a + t.amount_idr, 0);
  const expenses = rows.filter((t) => t.kind === "expense");
  const expense = expenses.reduce((a, t) => a + t.amount_idr, 0);
  const prevExpense = prevRows.reduce((a, t) => a + t.amount_idr, 0);
  const byCat = new Map<string, number>();
  for (const t of expenses)
    byCat.set(
      t.category?.name ?? "Tanpa kategori",
      (byCat.get(t.category?.name ?? "Tanpa kategori") ?? 0) + t.amount_idr,
    );
  const lastDay = p.end > addDays(today, 1) ? addDays(today, 1) : p.end;
  const days = Math.max(1, Math.round((Date.parse(lastDay) - Date.parse(p.start)) / 86400000));
  return {
    period: p,
    income,
    expense,
    net: income - expense,
    count: rows.length,
    truncated: cur.truncated || prevRes.truncated,
    prev_expense: prevExpense,
    change_pct: prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null,
    avg_per_day: expense / days,
    by_category: [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value })),
    top: [...expenses].sort((a, b) => b.amount_idr - a.amount_idr).slice(0, 3),
  };
}

export async function reportText(spec: string): Promise<string> {
  const d = await reportData(spec);
  if (!d) return "❓ Periode tidak dikenali. Contoh: /bulan 2026-05, atau /pengeluaran minggu.";
  const lines = [`📊 Laporan ${d.period.label}`, "", `💰 Pemasukan: ${idr(d.income)}`];
  const chg =
    d.change_pct == null
      ? ""
      : ` (${d.change_pct >= 0 ? "▲" : "▼"}${Math.abs(Math.round(d.change_pct))}% vs periode sebelumnya)`;
  lines.push(
    `💸 Pengeluaran: ${idr(d.expense)}${chg}`,
    `${d.net >= 0 ? "📈" : "📉"} Selisih: ${idr(d.net)}`,
    `🧾 ${d.count} transaksi${d.period.key !== "today" && d.period.key !== "yesterday" ? ` • rata-rata ${idr(d.avg_per_day)}/hari` : ""}`,
  );
  if (d.by_category.length) {
    lines.push("", "Pengeluaran per kategori:");
    for (const c of d.by_category.slice(0, 6))
      lines.push(
        `• ${c.name}: ${idr(c.value)} (${d.expense ? Math.round((c.value / d.expense) * 100) : 0}%)`,
      );
  }
  if (d.top.length) {
    lines.push("", "Terbesar:");
    for (const t of d.top)
      lines.push(
        `• ${shortDay(t.occurred_at)} — ${t.description ?? t.merchant ?? t.category?.name ?? "-"}: ${idr(t.amount_idr)}`,
      );
  }
  if (d.truncated) lines.push("", TRUNCATED_NOTE);
  if (!d.count) lines.push("", "Belum ada transaksi di periode ini.");
  if (
    d.period.key === "month" ||
    /^\d{4}-\d{2}$/.test(d.period.key) ||
    d.period.key === "lastmonth"
  ) {
    const bal = await balanceRows();
    lines.push("", `🏦 Total saldo saat ini: ${idr(bal.total)}`);
  }
  return lines.join("\n");
}

export async function listText(kind: "income" | "expense", spec: string): Promise<string> {
  const f = await fin();
  const p = resolvePeriod(spec, f.today());
  if (!p)
    return "❓ Periode tidak dikenali. Pakai: hariini, kemarin, minggu, bulan, bulanlalu, atau YYYY-MM.";
  const { rows, truncated } = await txIn(p.start, p.end, kind);
  const total = rows.reduce((a, t) => a + t.amount_idr, 0);
  const title = kind === "income" ? "💰 Pemasukan" : "💸 Pengeluaran";
  if (!rows.length) return `${title} ${p.label}\nBelum ada data.`;
  const lines = [`${title} ${p.label}`, `Total: ${idr(total)} (${rows.length} transaksi)`, ""];
  for (const t of rows.slice(0, 20))
    lines.push(
      `• ${shortDay(t.occurred_at)} ${t.description ?? t.merchant ?? "-"} — ${idr(t.amount_idr)}${t.category ? ` [${t.category.name}]` : ""}`,
    );
  if (rows.length > 20) lines.push(`… dan ${rows.length - 20} lainnya (lihat di web)`);
  if (truncated) lines.push("", TRUNCATED_NOTE);
  return lines.join("\n");
}

async function balanceRows() {
  const f = await fin();
  const rows = ((
    await db().from("account_balances").select("*").eq("archived", false).order("name")
  ).data ?? []) as any[];
  const rate = rows.some((a) => a.currency === "USD") ? await f.getUsdIdr() : 1;
  const total = rows.reduce((a, r) => a + Number(r.balance) * (r.currency === "USD" ? rate : 1), 0);
  return { rows, total };
}

export async function balancesText(): Promise<string> {
  const { rows, total } = await balanceRows();
  if (!rows.length) return "Belum ada akun terdaftar. Tambahkan di web → Akun.";
  const icon: Record<string, string> = {
    bank: "🏦",
    ewallet: "📱",
    cash: "💵",
    credit_card: "💳",
    investment: "📈",
    other: "•",
  };
  return [
    `💰 Saldo akun`,
    "",
    ...rows.map((a) => `${icon[a.type] ?? "•"} ${a.name}: ${money(Number(a.balance), a.currency)}`),
    "",
    `Total (IDR): ${idr(total)}`,
  ].join("\n");
}

export async function debtsText(): Promise<string> {
  const f = await fin();
  const debts = (await f.computeDebts()).filter(
    (d: any) => d.status === "active" && d.remaining_count > 0,
  );
  if (!debts.length) return "🎉 Tidak ada paylater/cicilan aktif.";
  const label: Record<string, string> = {
    paylater: "Paylater",
    loan: "Pinjaman",
    credit_card: "Kartu kredit",
    personal: "Pribadi",
    other: "Lainnya",
  };
  const rate = debts.some((d: any) => d.currency === "USD") ? await f.getUsdIdr() : 1;
  const total = debts.reduce(
    (a: number, d: any) => a + d.remaining_amount * (d.currency === "USD" ? rate : 1),
    0,
  );
  const monthly = debts.reduce(
    (a: number, d: any) => a + d.installment_amount * (d.currency === "USD" ? rate : 1),
    0,
  );
  const today = f.today();
  const lines = ["💳 Paylater & cicilan aktif", ""];
  for (const d of debts as any[]) {
    const late = d.next_due && d.next_due < today ? " ⚠️ TERLAMBAT" : "";
    lines.push(
      `• ${d.name}${d.provider ? ` (${d.provider})` : ""} — ${label[d.kind] ?? d.kind}`,
      `  ${money(d.installment_amount, d.currency)}/bln • sisa ${d.remaining_count}x = ${money(d.remaining_amount, d.currency)}`,
      `  Jatuh tempo: ${d.next_due ?? "-"}${late}`,
    );
  }
  lines.push(
    "",
    `Total sisa: ${idr(total)}`,
    `Cicilan per bulan: ${idr(monthly)}`,
    "Catat bayar: /bayar <nama>",
  );
  return lines.join("\n");
}

export async function subscriptionsText(): Promise<string> {
  const f = await fin();
  const subs = ((await db().from("subscriptions").select("*").eq("active", true).order("next_due"))
    .data ?? []) as any[];
  if (!subs.length) return "Belum ada langganan aktif.";
  const rate = subs.some((s) => s.currency === "USD") ? await f.getUsdIdr() : 1;
  const today = f.today();
  let monthlyIdr = 0;
  const lines = ["🔁 Langganan aktif", ""];
  for (const s of subs) {
    const amt = withTax(Number(s.amount), s.tax_percent);
    monthlyIdr += (s.cycle === "yearly" ? amt / 12 : amt) * (s.currency === "USD" ? rate : 1);
    const late = s.next_due < today ? " ⚠️ lewat" : s.next_due === today ? " • HARI INI" : "";
    lines.push(
      `• ${s.name}: ${money(amt, s.currency)}/${s.cycle === "yearly" ? "thn" : "bln"} — ${s.next_due}${late}`,
    );
  }
  lines.push(
    "",
    `Setara per bulan: ${idr(monthlyIdr)}`,
    `Setara per tahun: ${idr(monthlyIdr * 12)}`,
    "Catat bayar: /bayar <nama>",
  );
  return lines.join("\n");
}

export async function budgetText(): Promise<string> {
  const f = await fin();
  const month = f.today().slice(0, 7);
  const list = await f.computeBudgets(month);
  if (!list.length) return "Belum ada budget. Atur di web → Budget.";
  const bar = (pct: number) => {
    const n = Math.min(10, Math.round(pct / 10));
    return "▓".repeat(n) + "░".repeat(10 - n);
  };
  const lines = [`🎯 Budget ${month}`, ""];
  for (const b of list.sort((a, b) => b.percent - a.percent)) {
    const flag = b.percent >= 100 ? " 🔴" : b.percent >= b.alert_percent ? " 🟠" : "";
    lines.push(
      `• ${b.category}${flag}`,
      `  ${bar(b.percent)} ${Math.round(b.percent)}% — ${idr(b.spent)} / ${idr(b.amount)}`,
    );
  }
  return lines.join("\n");
}

export async function receivablesText(): Promise<string> {
  const f = await fin();
  const r = await db()
    .from("receivables")
    .select("id, name, borrower, amount, currency, due_date")
    .eq("status", "active")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (r.error)
    return f.isMissingTable(r.error)
      ? "Fitur piutang belum aktif (jalankan skema v3)."
      : `⚠️ ${r.error.message}`;
  const rows = (r.data ?? []) as any[];
  if (!rows.length) return "🎉 Tidak ada piutang aktif.";
  const pays = ((
    await db()
      .from("receivable_payments")
      .select("receivable_id, amount")
      .in(
        "receivable_id",
        rows.map((x) => x.id),
      )
  ).data ?? []) as any[];
  const lines = ["🤝 Piutang aktif", ""];
  for (const x of rows) {
    const paid = pays
      .filter((p) => p.receivable_id === x.id)
      .reduce((a, p) => a + Number(p.amount), 0);
    lines.push(
      `• ${x.name}${x.borrower ? ` (${x.borrower})` : ""}: sisa ${money(Number(x.amount) - paid, x.currency)}${x.due_date ? ` — jatuh tempo ${x.due_date}` : ""}`,
    );
  }
  return lines.join("\n");
}
