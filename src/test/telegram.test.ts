import { describe, expect, it } from "vitest";
import {
  TG_MAX_IMAGE_BYTES,
  isValidWebhookSecret,
  parseTelegramUpdate,
  replyCalls,
  webhookUrl,
} from "@/lib/telegram";

const chat = { id: 111 };

describe("parseTelegramUpdate", () => {
  it("maps text, callbacks and unsupported messages like the n8n template", () => {
    expect(
      parseTelegramUpdate({ update_id: 1, message: { message_id: 5, chat, text: "kopi 25rb" } }),
    ).toEqual({
      type: "text",
      update_id: 1,
      chat_id: "111",
      message_id: 5,
      callback_id: null,
      text: "kopi 25rb",
    });
    const cb = parseTelegramUpdate({
      update_id: 2,
      callback_query: {
        id: "cbid",
        data: "d:s:x",
        from: { id: 111 },
        message: { message_id: 9, chat },
      },
    });
    expect(cb).toMatchObject({
      type: "callback",
      callback_id: "cbid",
      message_id: 9,
      callback_data: "d:s:x",
    });
    expect(
      parseTelegramUpdate({ update_id: 3, message: { message_id: 1, chat, sticker: {} } }),
    ).toMatchObject({
      type: "reply",
    });
    expect(parseTelegramUpdate({ update_id: 4, edited_message: {} })).toEqual({ type: "ignore" });
    expect(parseTelegramUpdate(null)).toEqual({ type: "ignore" });
  });

  it("picks the largest photo under the cap and accepts image documents", () => {
    const r = parseTelegramUpdate({
      update_id: 5,
      message: {
        message_id: 1,
        chat,
        caption: "pakai BCA",
        photo: [
          { file_id: "s", file_size: 10_000 },
          { file_id: "m", file_size: 900_000 },
          { file_id: "xl", file_size: TG_MAX_IMAGE_BYTES + 1 },
        ],
      },
    });
    expect(r).toMatchObject({
      type: "image",
      file_id: "m",
      mime_type: "image/jpeg",
      caption: "pakai BCA",
    });
    const doc = parseTelegramUpdate({
      update_id: 6,
      message: {
        message_id: 1,
        chat,
        document: { file_id: "d", mime_type: "image/png", file_size: 5 },
      },
    });
    expect(doc).toMatchObject({ type: "image", file_id: "d", mime_type: "image/png" });
    const pdf = parseTelegramUpdate({
      update_id: 7,
      message: { message_id: 1, chat, document: { file_id: "d", mime_type: "application/pdf" } },
    });
    expect(pdf.type).toBe("reply");
  });
});

describe("replyCalls", () => {
  const ctx = { update_id: 1, chat_id: "111", message_id: 9, callback_id: null };
  it("sends, edits and answers callbacks", () => {
    expect(replyCalls(ctx, { method: "send", text: "hi", reply_markup: null })).toEqual([
      {
        method: "sendMessage",
        body: { chat_id: "111", text: "hi", disable_web_page_preview: true },
      },
    ]);
    const kb = { inline_keyboard: [[{ text: "OK", callback_data: "x" }]] };
    const calls = replyCalls(
      { ...ctx, callback_id: "cb" },
      { method: "edit", text: "e", reply_markup: kb, toast: "✓" },
    );
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(calls[0]!.body).toEqual({ callback_query_id: "cb", text: "✓" });
    expect(calls[1]!.body).toMatchObject({ message_id: 9, reply_markup: kb });
    expect(replyCalls(ctx, { method: "none", text: "" })).toEqual([]);
    expect(
      String(replyCalls(ctx, { method: "send", text: "x".repeat(5000) })[0]!.body["text"]).length,
    ).toBe(4000);
  });
});

describe("webhook helpers", () => {
  it("builds an https webhook URL only", () => {
    expect(webhookUrl("https://app.example.com/settings")).toBe(
      "https://app.example.com/api/public/telegram/webhook",
    );
    expect(webhookUrl("http://localhost:3000")).toBeNull();
    expect(isValidWebhookSecret("abc_-1")).toBe(true);
    expect(isValidWebhookSecret("a=b")).toBe(false);
  });
});
