import { describe, expect, it } from "vitest";
import { botUpdateSchema, MAX_BOT_BODY_BYTES, readJsonBody } from "../lib/bot-request";

const img = "A".repeat(200);
const base = { update_id: 1, chat_id: "111" };

describe("botUpdateSchema — gambar", () => {
  it("menerima jpeg/png/webp dan menormalkan image/jpg", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp"])
      expect(botUpdateSchema.parse({ ...base, image_base64: img, mime_type: m }).mime_type).toBe(m);
    expect(
      botUpdateSchema.parse({ ...base, image_base64: img, mime_type: "image/jpg" }).mime_type,
    ).toBe("image/jpeg");
    expect(
      botUpdateSchema.parse({ ...base, image_base64: img, mime_type: "IMAGE/JPEG" }).mime_type,
    ).toBe("image/jpeg");
  });
  it("menolak MIME lain", () => {
    for (const m of ["image/gif", "image/svg+xml", "application/pdf", "text/html"])
      expect(botUpdateSchema.safeParse({ ...base, image_base64: img, mime_type: m }).success).toBe(
        false,
      );
  });
  it("mime_type wajib bila image_base64 ada", () => {
    const r = botUpdateSchema.safeParse({ ...base, image_base64: img });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.flatten())).toContain("mime_type");
    expect(botUpdateSchema.safeParse({ ...base, image_base64: img, mime_type: null }).success).toBe(
      false,
    );
  });
  it("teks/tombol tanpa mime_type tetap valid", () => {
    expect(botUpdateSchema.safeParse({ ...base, text: "kopi 25rb" }).success).toBe(true);
    expect(botUpdateSchema.safeParse({ ...base, callback_data: "d:s:x" }).success).toBe(true);
  });
});

describe("botUpdateSchema — grup (#71)", () => {
  const t = { ...base, text: "kopi @dompetkubot" };
  it("chat_type/reply_to_bot/bot_username opsional (template lama tetap valid)", () => {
    const v = botUpdateSchema.parse(t);
    expect(v.chat_type).toBeUndefined();
    expect(v.reply_to_bot).toBeUndefined();
    expect(v.bot_username).toBeUndefined();
    expect(
      botUpdateSchema.safeParse({ ...t, chat_type: null, reply_to_bot: null, bot_username: null })
        .success,
    ).toBe(true);
  });
  it("menerima field grup dan membuang @ di depan username", () => {
    for (const c of ["private", "group", "supergroup", "channel"])
      expect(botUpdateSchema.parse({ ...t, chat_type: c }).chat_type).toBe(c);
    const v = botUpdateSchema.parse({
      ...t,
      chat_type: "supergroup",
      reply_to_bot: true,
      bot_username: " @DompetkuBot ",
    });
    expect(v).toMatchObject({ reply_to_bot: true, bot_username: "DompetkuBot" });
  });
  it("menolak nilai tidak valid", () => {
    for (const bad of [
      { chat_type: "forum" },
      { reply_to_bot: "yes" },
      { bot_username: "ab" },
      { bot_username: "bad name" },
      { bot_username: "x".repeat(65) },
    ])
      expect(botUpdateSchema.safeParse({ ...t, ...bad }).success).toBe(false);
  });
});

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://x/api/public/n8n/bot", { method: "POST", body, headers });

describe("readJsonBody — batas ukuran", () => {
  it("Content-Length terlalu besar → 413 tanpa membaca body", async () => {
    const req = post("{}", { "content-length": String(MAX_BOT_BODY_BYTES + 1) });
    const r = await readJsonBody(req);
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(req.bodyUsed).toBe(false);
  });
  it("tanpa Content-Length: body stream yang kebesaran → 413", async () => {
    const chunk = new Uint8Array(1000).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > 20) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const req = new Request("http://x", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readJsonBody(req, 5000)).toMatchObject({ ok: false, status: 413 });
  });
  it("body kecil yang valid diurai; JSON rusak → 400", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(await readJsonBody(post("{oops"))).toMatchObject({ ok: false, status: 400 });
  });
});
