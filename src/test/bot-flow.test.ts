/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fakes */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Minimal in-memory PostgREST-like fake, enough for the bot flow. */
// Loosely typed on purpose: rows are dynamic and accessed with dot notation
// (strict noPropertyAccessFromIndexSignature would reject Record<string, any>).
type Row = any;
const tables: Record<string, Row[]> = {};
const dbCalls: string[] = [];
/** Force every query on a table to fail with this PostgREST-style error. */
const failing: Record<string, { message: string; code?: string }> = {};
function like(v: unknown, pattern: string, ci: boolean) {
  const re = new RegExp(
    "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
    ci ? "i" : "",
  );
  return re.test(String(v ?? ""));
}
function q(table: string) {
  dbCalls.push(table);
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: any = null;
  let single: "one" | "maybe" | null = null;
  let lim = Infinity;
  let skip = 0;
  const api: any = {
    select: () => api,
    order: () => api,
    insert: (v: any) => ((op = "insert"), (payload = v), api),
    update: (v: any) => ((op = "update"), (payload = v), api),
    delete: () => ((op = "delete"), api),
    eq: (k: string, v: any) => (filters.push((r) => String(r[k]) === String(v)), api),
    neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), api),
    ilike: (k: string, v: string) => (filters.push((r) => like(r[k], v, true)), api),
    like: (k: string, v: string) => (filters.push((r) => like(r[k], v, false)), api),
    not: (k: string, o: string, v: any) => (
      filters.push((r) => (o === "is" ? r[k] != null : !like(r[k], v, false))),
      api
    ),
    in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
    gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), api),
    lt: (k: string, v: any) => (filters.push((r) => r[k] < v), api),
    lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), api),
    limit: (n: number) => ((lim = n), api),
    range: (a: number, b: number) => ((skip = a), (lim = b - a + 1), api),
    single: () => ((single = "one"), api),
    maybeSingle: () => ((single = "maybe"), api),
    then: (res: (v: any) => void) => res(run()),
  };
  function run() {
    if (failing[table]) return { data: null, error: failing[table] };
    const t = (tables[table] ??= []);
    if (op === "insert") {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...r,
      }));
      for (const r of rows)
        if (r.external_id && t.some((x) => x.external_id === r.external_id))
          return {
            data: null,
            error: { message: "duplicate key value violates unique constraint" },
          };
      t.push(...rows);
      return { data: single ? rows[0] : rows, error: null };
    }
    const hit = t.filter((r) => filters.every((f) => f(r)));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    if (op === "delete") tables[table] = t.filter((r) => !hit.includes(r));
    const rows = hit.slice(skip, skip + lim).map((r) => ({
      ...r,
      category: tables["categories"]?.find((c) => c.id === r.category_id) ?? null,
    }));
    if (single)
      return {
        data: rows[0] ?? null,
        error: single === "one" && !rows[0] ? { message: "not found" } : null,
      };
    return { data: rows, error: null };
  }
  return api;
}
vi.mock("../lib/db.server", () => ({
  db: () => ({ from: q, storage: { from: () => ({ remove: async () => ({}) }) } }),
}));

import {
  draftKey,
  handleBotUpdate,
  isBotTransaction,
  listText,
  reportText,
  TX_HARD_CAP,
} from "../lib/bot.server";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  dbCalls.length = 0;
  for (const k of Object.keys(failing)) delete failing[k];
  tables["categories"] = [
    { id: "c1", name: "Makanan & Minuman", kind: "expense" },
    { id: "c2", name: "Transportasi", kind: "expense" },
    { id: "c3", name: "Lainnya", kind: "expense" },
    { id: "c4", name: "Gaji", kind: "income" },
    { id: "c5", name: "Lainnya", kind: "income" },
  ];
  tables["accounts"] = [
    { id: "a1", name: "BCA", archived: false, currency: "IDR", type: "bank" },
    { id: "a2", name: "GoPay", archived: false, currency: "IDR", type: "ewallet" },
  ];
  process.env["BOT_DEFAULT_ACCOUNT"] = "BCA";
  process.env["BOT_ALLOWED_CHAT_IDS"] = "111";
  delete process.env["AI_API_KEY"];
});

const cb = (data: string) =>
  handleBotUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    chat_id: "111",
    callback_data: data,
  });

describe("alur bot end-to-end (tanpa AI)", () => {
  it("chat → pratinjau → ganti kategori → simpan → idempoten → undo", async () => {
    const r1 = await handleBotUpdate({
      update_id: 1,
      chat_id: "111",
      text: "kopi 25rb pakai gopay",
    });
    expect(r1.method).toBe("send");
    expect(r1.text).toContain("Rp");
    expect(r1.text).toContain("Makanan & Minuman");
    expect(r1.text).toContain("GoPay");
    const id = tables["bot_drafts"]![0]!.id;

    // retry webhook yang sama → draft tidak dobel
    await handleBotUpdate({ update_id: 1, chat_id: "111", text: "kopi 25rb pakai gopay" });
    expect(tables["bot_drafts"]).toHaveLength(1);

    const menu = await cb(`d:c:${id}`);
    expect(menu.reply_markup!.inline_keyboard.flat().map((b) => b.text)).toContain("Transportasi");
    const changed = await cb(`d:C:${id}:2`); // urutan list: Makanan & Minuman, Transportasi, Lainnya (dari fake)
    expect(changed.method).toBe("edit");

    const saved = await cb(`d:s:${id}`);
    expect(saved.text).toContain("✅ Tercatat");
    expect(saved.toast).toBe("Tersimpan");
    expect(tables["transactions"]).toHaveLength(1);
    expect(tables["transactions"]![0]!.account_id).toBe("a2");
    expect(tables["transactions"]![0]!.external_id).toBe(`draft:${id}`);

    const again = await cb(`d:s:${id}`); // klik ganda
    expect(again.text).toContain("Sudah tersimpan");
    expect(tables["transactions"]).toHaveLength(1);

    const txId = tables["transactions"]![0]!.id;
    const undo = await cb(`u:${txId}`);
    expect(undo.text).toContain("Dihapus");
    expect(tables["transactions"]).toHaveLength(0);
    expect(tables["bot_drafts"]![0]!.status).toBe("undone");
  });

  it("akun default dipakai saat tidak disebut; batal tidak menyimpan", async () => {
    const r = await handleBotUpdate({ update_id: 2, chat_id: "111", text: "gaji 8jt" });
    expect(r.text).toContain("BCA (default)");
    expect(r.text).toContain("Gaji");
    const id = tables["bot_drafts"]![0]!.id;
    const x = await cb(`d:x:${id}`);
    expect(x.text).toContain("Dibatalkan");
    expect(tables["transactions"] ?? []).toHaveLength(0);
  });

  it("chat asing ditolak tanpa menyentuh DB, perintah tidak memakai AI", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handleBotUpdate({ update_id: 3, chat_id: "999", text: "kopi 25rb" });
    expect(r.method).toBe("send");
    expect(r.text).toContain("chat_id 999");
    expect(r.text).toContain("BOT_ALLOWED_CHAT_IDS");
    expect(dbCalls).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const help = await handleBotUpdate({ update_id: 4, chat_id: "111", text: "/help" });
    expect(help.text).toContain("/paylater");
  });

  it("allow-list kosong menolak semua chat (fail-closed), termasuk tombol & foto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const v of [undefined, "", " , "]) {
      if (v === undefined) delete process.env["BOT_ALLOWED_CHAT_IDS"];
      else process.env["BOT_ALLOWED_CHAT_IDS"] = v;
      const t = await handleBotUpdate({ update_id: 9, chat_id: "111", text: "kopi 25rb" });
      expect(t).toMatchObject({ method: "send", reply_markup: null });
      expect(t.text).toContain(
        "Bot belum dikonfigurasi: tambahkan chat_id 111 ke BOT_ALLOWED_CHAT_IDS",
      );
      await handleBotUpdate({
        update_id: 10,
        chat_id: "111",
        callback_data: "d:s:0f8fad5b-d9cb-469f-a165-70867728950e",
      });
      await handleBotUpdate({
        update_id: 11,
        chat_id: "111",
        image_base64: "x".repeat(200),
        mime_type: "image/jpeg",
      });
    }
    expect(dbCalls).toEqual([]);
    expect(tables["bot_drafts"]).toBeUndefined();
    warn.mockRestore();
  });

  it("pesan ambigu tanpa AI key memberi error ramah (bukan crash diam)", async () => {
    await expect(
      handleBotUpdate({ update_id: 5, chat_id: "111", text: "kemarin patungan sama andi 120rb" }),
    ).rejects.toThrow(/AI_API_KEY/);
  });

  it("chat tanpa nominal atau terlalu panjang tidak dikirim ke AI", async () => {
    const r = await handleBotUpdate({ update_id: 6, chat_id: "111", text: "halo apa kabar" });
    expect(r.text).toContain("Nominal tidak terbaca");
    const long = await handleBotUpdate({
      update_id: 7,
      chat_id: "111",
      text: `kemarin patungan 50rb ${"x".repeat(320)}`,
    });
    expect(long.text).toContain("terlalu panjang");
    expect(dbCalls).not.toContain("ai_usage"); // not even the quota check
    expect(tables["bot_drafts"] ?? []).toHaveLength(0);
  });

  it("kuota AI harian per chat menghentikan AI chat dan foto sebelum dipanggil", async () => {
    const { today } = await import("../lib/finance.server");
    tables["ai_usage"] = Array.from({ length: 3 }, () => ({
      source: "bot",
      chat_id: "111",
      day: today(),
    }));
    process.env["BOT_AI_DAILY_LIMIT"] = "3";
    try {
      const t = await handleBotUpdate({
        update_id: 8,
        chat_id: "111",
        text: "kemarin patungan sama andi 120rb",
      });
      expect(t.text).toContain("Kuota AI harian");
      const p = await handleBotUpdate({
        update_id: 9,
        chat_id: "111",
        image_base64: "x".repeat(200),
        mime_type: "image/jpeg",
      });
      expect(p.text).toContain("Kuota AI harian");
      // chat lain belum kena kuota → AI dicoba (gagal karena tanpa key)
      process.env["BOT_ALLOWED_CHAT_IDS"] = "111,222";
      await expect(
        handleBotUpdate({ update_id: 10, chat_id: "222", text: "patungan sama andi 120rb" }),
      ).rejects.toThrow(/AI_API_KEY/);
      // "0" = tanpa batas
      process.env["BOT_AI_DAILY_LIMIT"] = "0";
      await expect(
        handleBotUpdate({ update_id: 11, chat_id: "111", text: "patungan sama andi 120rb" }),
      ).rejects.toThrow(/AI_API_KEY/);
    } finally {
      delete process.env["BOT_AI_DAILY_LIMIT"];
    }
  });

  it("undo lewat callback tidak bisa menghapus transaksi sembarang", async () => {
    tables["transactions"] = [
      {
        id: "0f8fad5b-d9cb-469f-a165-70867728950e",
        source: "telegram",
        amount: 5,
        currency: "IDR",
        created_at: new Date().toISOString(),
        notes: null,
      },
      {
        id: "1f8fad5b-d9cb-469f-a165-70867728950e",
        source: "ocr",
        amount: 5,
        currency: "IDR",
        created_at: new Date().toISOString(),
        notes: null,
      },
    ];
    // tidak ada bot_drafts yang menautkan transaksi ini → ditolak walau source "telegram"
    const r = await cb("u:0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(r.text).toContain("Hanya transaksi");
    // /undo tidak menyentuh struk OCR dari web
    const u = await handleBotUpdate({ update_id: 6, chat_id: "111", text: "/undo" });
    expect(u.text).toContain("Dihapus");
    expect(tables["transactions"]!.map((t) => t.id)).toEqual([
      "1f8fad5b-d9cb-469f-a165-70867728950e",
    ]);
  });

  it("kunci idempotensi draft memuat chat_id: update_id sama di chat lain tidak bentrok", async () => {
    process.env["BOT_ALLOWED_CHAT_IDS"] = "111,222";
    const a = await handleBotUpdate({ update_id: 42, chat_id: "111", text: "kopi 25rb" });
    const b = await handleBotUpdate({ update_id: 42, chat_id: "222", text: "gaji 8jt" });
    expect(tables["bot_drafts"]!.map((d) => d.external_id)).toEqual(["tg:111:42", "tg:222:42"]);
    expect(a.text).toContain("Makanan");
    expect(b.text).toContain("Gaji"); // bukan pratinjau milik chat 111
    // retry di chat yang sama tetap idempoten
    await handleBotUpdate({ update_id: 42, chat_id: "222", text: "gaji 8jt" });
    expect(tables["bot_drafts"]).toHaveLength(2);
    // simpan + undo tetap jalan dengan kunci baru
    const id = tables["bot_drafts"]![1]!.id;
    await handleBotUpdate({ update_id: 43, chat_id: "222", callback_data: `d:s:${id}` });
    expect(tables["transactions"]![0]!.external_id).toBe(`draft:${id}`);
    const txId = tables["transactions"]![0]!.id;
    const u = await handleBotUpdate({ update_id: 44, chat_id: "222", callback_data: `u:${txId}` });
    expect(u.text).toContain("Dihapus");
  });

  it("pratinjau milik chat lain tidak bisa disimpan", async () => {
    process.env["BOT_ALLOWED_CHAT_IDS"] = "111,222";
    await handleBotUpdate({ update_id: 7, chat_id: "111", text: "kopi 25rb" });
    const id = tables["bot_drafts"]![0]!.id;
    const r = await handleBotUpdate({ update_id: 8, chat_id: "222", callback_data: `d:s:${id}` });
    expect(r.text).toContain("tidak ditemukan");
    expect(tables["transactions"] ?? []).toHaveLength(0);
  });
});

describe("undo hanya untuk transaksi bot", () => {
  it("ocr dari web tidak bisa di-undo lewat bot", () => {
    expect(isBotTransaction({ source: "ocr", raw: null, external_id: null })).toBe(false);
    expect(isBotTransaction({ source: "ocr", external_id: "draft:abc" })).toBe(true);
    expect(isBotTransaction({ source: "ocr", raw: { ocr: {} } })).toBe(true);
    expect(isBotTransaction({ source: "telegram" })).toBe(true);
    expect(isBotTransaction({ source: "web" })).toBe(false);
    expect(isBotTransaction({ source: "telegram", notes: "[fee:x]" })).toBe(false);
  });
  it("format kunci draft", () => {
    expect(draftKey("-100123", 7)).toBe("tg:-100123:7");
  });
});

describe("laporan tidak terpotong diam-diam", () => {
  const today = new Date().toISOString().slice(0, 10);
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      kind: "expense",
      amount_idr: "1000",
      occurred_at: today,
      description: `x${i}`,
      category_id: "c1",
    }));

  it("menjumlahkan lebih dari 5000 transaksi lewat paging", async () => {
    tables["transactions"] = mk(7_500);
    const list = await listText("expense", "bulan");
    expect(list).toContain("7500 transaksi");
    expect(list).toMatch(/Rp\s?7\.500\.000/);
    expect(list).not.toContain("data terpotong");
    const rep = await reportText("bulan");
    expect(rep).toMatch(/Pengeluaran: Rp\s?7\.500\.000/);
    expect(rep).not.toContain("data terpotong");
  });

  it("tepat di batas keras tidak dianggap terpotong", async () => {
    tables["transactions"] = mk(TX_HARD_CAP);
    expect(await listText("expense", "bulan")).not.toContain("data terpotong");
  });

  it("melewati batas keras memberi catatan (data terpotong)", async () => {
    tables["transactions"] = mk(TX_HARD_CAP + 1);
    const list = await listText("expense", "bulan");
    expect(list).toContain(`${TX_HARD_CAP} transaksi`);
    expect(list).toContain("(data terpotong)");
    expect(await reportText("bulan")).toContain("(data terpotong)");
  });
});

describe("bot_drafts belum ada vs error DB lain", () => {
  const missing = {
    code: "PGRST205",
    message: "Could not find the table 'public.bot_drafts' in the schema cache",
  };

  it("tabel hilang → pesan ramah 'jalankan v7', bukan crash", async () => {
    failing["bot_drafts"] = missing;
    await expect(
      handleBotUpdate({ update_id: 50, chat_id: "111", text: "kopi 25rb" }),
    ).rejects.toThrow(/bot_drafts belum ada.*v7/);
    const r = await handleBotUpdate({
      update_id: 51,
      chat_id: "111",
      callback_data: "d:s:0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(r.text).toMatch(/v7/);
  });

  it("error lain tidak ditelan (tidak dianggap draft kosong)", async () => {
    failing["bot_drafts"] = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    await expect(
      handleBotUpdate({ update_id: 52, chat_id: "111", text: "kopi 25rb" }),
    ).rejects.toThrow(/statement timeout/);
    await expect(
      handleBotUpdate({
        update_id: 53,
        chat_id: "111",
        callback_data: "d:s:0f8fad5b-d9cb-469f-a165-70867728950e",
      }),
    ).rejects.toThrow(/statement timeout/);
    await expect(
      handleBotUpdate({
        update_id: 54,
        chat_id: "111",
        callback_data: "u:0f8fad5b-d9cb-469f-a165-70867728950e",
      }),
    ).rejects.toThrow(/statement timeout/);
    expect(tables["transactions"] ?? []).toHaveLength(0);
  });
});
