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
  db: () => ({
    from: q,
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({ remove: async () => ({}), upload: async () => ({ error: null }) }),
    },
  }),
}));
// Receipt OCR without a real AI endpoint (only reached by tests that send a photo past the quota).
vi.mock("../lib/ocr.server", async (orig) => ({
  ...(await orig<typeof import("../lib/ocr.server")>()),
  parseReceipt: vi.fn(async () => ({
    kind: "expense",
    amount: 150000,
    currency: "IDR",
    category: "Lainnya",
    account: null,
    description: "Transfer BI-FAST ke Yusuf 123",
    merchant: "Bank BCA",
    date: null,
    items: [{ name: "Transfer", qty: 1, price: 150000 }],
  })),
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
    expect(dbCalls.filter((t) => t !== "integration_settings")).toEqual([]); // config only
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
    expect(dbCalls.filter((t) => t !== "integration_settings")).toEqual([]); // config only
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

describe("✏️ Keterangan: ganti keterangan pratinjau (#68)", () => {
  const photo = (update_id: number, chat_id = "111") =>
    handleBotUpdate({
      update_id,
      chat_id,
      image_base64: Buffer.from("fake-jpeg").toString("base64"),
      mime_type: "image/jpeg",
    });
  const say = (update_id: number, text: string, chat_id = "111") =>
    handleBotUpdate({ update_id, chat_id, text });
  const draft = () => tables["bot_drafts"]![0]!;

  it("foto nota → Keterangan → kirim teks → pratinjau baru → simpan memakai keterangan baru", async () => {
    const p = await photo(100);
    expect(p.text).toContain("🧾 Pratinjau nota");
    expect(p.text).toContain("Ket: Transfer BI-FAST ke Yusuf 123");
    expect(p.reply_markup!.inline_keyboard.flat().map((b) => b.callback_data)).toContain(
      `d:e:${draft().id}`,
    );
    const id = draft().id;
    const receipt = draft().receipt_path;
    expect(receipt).toBeTruthy();

    const prompt = await cb(`d:e:${id}`);
    expect(prompt.method).toBe("edit");
    expect(prompt.text).toContain("Kirim keterangan baru");
    expect(prompt.text).toContain("Sekarang: Transfer BI-FAST ke Yusuf 123");
    expect(prompt.reply_markup!.inline_keyboard.flat()).toEqual([
      { text: "⬅️ Kembali", callback_data: `d:b:${id}` },
    ]);
    expect(draft().payload.awaiting.field).toBe("description");

    const r = await say(101, "  dini\u0007  bayar   baju ");
    expect(r.method).toBe("send");
    expect(r.text).toContain("Ket: dini bayar baju");
    expect(r.text).toContain("Merchant: Bank BCA");
    expect(r.text).toContain("Transfer — ");
    expect(r.text).not.toContain("awaiting");
    expect(r.reply_markup!.inline_keyboard[0]![0]!.callback_data).toBe(`d:s:${id}`);
    expect(tables["bot_drafts"]).toHaveLength(1); // no new draft from the text
    expect(draft().payload.awaiting).toBeUndefined();

    // webhook retry of the same text update: same preview, no new draft, nothing changes
    const again = await say(101, "  dini\u0007  bayar   baju ");
    expect(again.text).toContain("Ket: dini bayar baju");
    expect(tables["bot_drafts"]).toHaveLength(1);

    // the flag is gone: the next chat is a normal transaction again
    await say(102, "kopi 25rb");
    expect(tables["bot_drafts"]).toHaveLength(2);

    const saved = await cb(`d:s:${id}`);
    expect(saved.text).toContain("✅ Tercatat");
    const tx = tables["transactions"]![0]!;
    expect(tx.description).toBe("dini bayar baju");
    expect(tx.merchant).toBe("Bank BCA");
    expect(tx.receipt_path).toBe(receipt);
    expect(tx.items).toEqual([{ name: "Transfer", qty: 1, price: 150000 }]);
    expect(JSON.stringify(tx)).not.toContain("awaiting");
  });

  it("pratinjau chat teks juga bisa diganti keterangannya; Kembali membatalkan prompt", async () => {
    await say(110, "kopi 25rb pakai gopay");
    const id = draft().id;
    await cb(`d:e:${id}`);
    const back = await cb(`d:b:${id}`);
    expect(back.text).toContain("Ket: Kopi");
    expect(draft().payload.awaiting).toBeUndefined();
    await say(111, "es teh 5rb"); // normal chat again
    expect(tables["bot_drafts"]).toHaveLength(2);

    await cb(`d:e:${id}`);
    const r = await say(112, "kopi susu sama dini");
    expect(r.text).toContain("Ket: kopi susu sama dini");
    await cb(`d:s:${id}`);
    expect(tables["transactions"]![0]!.description).toBe("kopi susu sama dini");
  });

  it("/batal membatalkan edit (bukan undo), perintah lain tetap jalan", async () => {
    await say(120, "kopi 25rb");
    const id = draft().id;
    await cb(`d:s:${id}`); // a saved tx that /batal (= undo) must NOT delete
    await say(121, "gaji 8jt");
    const id2 = tables["bot_drafts"]![1]!.id;
    await cb(`d:e:${id2}`);
    const c = await say(122, "/batal");
    expect(c.text).toContain("Edit keterangan dibatalkan.");
    expect(c.text).toContain("Ket: Gaji");
    expect(tables["transactions"]).toHaveLength(1);
    expect(tables["bot_drafts"]![1]!.payload.awaiting).toBeUndefined();
    const retry = await say(122, "/batal"); // retried update: still not an undo
    expect(retry.text).toContain("dibatalkan");
    expect(tables["transactions"]).toHaveLength(1);

    await cb(`d:e:${id2}`);
    const help = await say(123, "/help");
    expect(help.text).toContain("/paylater");
    expect(tables["bot_drafts"]![1]!.payload.awaiting).toBeUndefined();
    await say(124, "es teh 5rb");
    expect(tables["bot_drafts"]).toHaveLength(3);
    expect(tables["bot_drafts"]![1]!.payload.description).toBe("Gaji");
  });

  it("flag kedaluwarsa (> 10 menit) diabaikan: chat diproses seperti biasa", async () => {
    await say(130, "kopi 25rb");
    const id = draft().id;
    await cb(`d:e:${id}`);
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    draft().payload.awaiting.at = old;
    draft().updated_at = old;
    const r = await say(131, "es teh 5rb");
    expect(r.text).toContain("Es teh");
    expect(tables["bot_drafts"]).toHaveLength(2);
    expect(draft().payload.description).toBe("Kopi");
  });

  it("chat lain tidak bisa membajak edit; draft tersimpan tidak bisa diedit", async () => {
    process.env["BOT_ALLOWED_CHAT_IDS"] = "111,222";
    await say(140, "kopi 25rb");
    const id = draft().id;
    const forged = await handleBotUpdate({
      update_id: 141,
      chat_id: "222",
      callback_data: `d:e:${id}`,
    });
    expect(forged.text).toContain("tidak ditemukan");
    expect(draft().payload.awaiting).toBeUndefined();

    await cb(`d:e:${id}`);
    await say(142, "es teh 5rb", "222"); // other chat → its own new draft
    expect(tables["bot_drafts"]).toHaveLength(2);
    expect(draft().payload.description).toBe("Kopi");
    expect(draft().payload.awaiting).toBeTruthy();

    await cb(`d:s:${id}`); // saving ends the prompt (draft no longer pending)
    expect(tables["transactions"]![0]!.description).toBe("Kopi");
    await say(143, "roti 10rb");
    expect(tables["bot_drafts"]).toHaveLength(3);
  });

  it("teks kosong setelah dibersihkan meminta ulang", async () => {
    await say(150, "kopi 25rb");
    const id = draft().id;
    await cb(`d:e:${id}`);
    const r = await say(151, "\u200b\u200b");
    expect(r.text).toContain("Kirim keterangan baru");
    expect(draft().payload.awaiting).toBeTruthy();
  });

  it("tabel bot_drafts hilang: chat tetap memberi pesan v7 seperti sebelumnya", async () => {
    failing["bot_drafts"] = {
      code: "PGRST205",
      message: "Could not find the table 'public.bot_drafts' in the schema cache",
    };
    await expect(say(160, "kopi 25rb")).rejects.toThrow(/bot_drafts belum ada.*v7/);
    expect((await say(161, "/help")).text).toContain("/paylater");
  });
});
