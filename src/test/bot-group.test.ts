import { describe, expect, it } from "vitest";
import { groupAddress, isGroupChat } from "@/lib/bot-group";

const g = (text: string | null, extra: Record<string, unknown> = {}) =>
  groupAddress({ text, chatType: "group", botUsername: "chatbotfinance", ...extra });

describe("isGroupChat", () => {
  it("only group and supergroup", () => {
    expect(isGroupChat("group")).toBe(true);
    expect(isGroupChat("supergroup")).toBe(true);
    for (const t of ["private", "channel", "", null, undefined]) expect(isGroupChat(t)).toBe(false);
  });
});

describe("groupAddress", () => {
  it("passes private chats and missing chat_type through unchanged", () => {
    for (const chatType of ["private", null, undefined])
      expect(groupAddress({ text: "  kopi 25rb @budi ", chatType })).toEqual({
        addressed: true,
        text: "  kopi 25rb @budi ",
      });
    expect(groupAddress({ text: null })).toEqual({ addressed: true, text: "" });
  });

  it("strips the bot mention (issue #71 example)", () => {
    expect(g("pemasukan 500rb di akun A @chatbotfinance")).toEqual({
      addressed: true,
      text: "pemasukan 500rb di akun A",
    });
    expect(g("@chatbotfinance kopi 25rb").text).toBe("kopi 25rb");
    expect(g("kopi   @chatbotfinance 25rb").text).toBe("kopi 25rb");
    expect(g("kopi 25rb @ChatBotFinance, ya").text).toBe("kopi 25rb , ya");
    expect(g("@CHATBOTFINANCE")).toEqual({ addressed: true, text: "" });
  });

  it("supergroup works like group", () => {
    expect(
      groupAddress({
        text: "kopi @chatbotfinance",
        chatType: "supergroup",
        botUsername: "chatbotfinance",
      }),
    ).toEqual({ addressed: true, text: "kopi" });
  });

  it("ignores chatter, other users and lookalike mentions", () => {
    for (const t of [
      "kopi 25rb",
      "kopi 25rb @budi",
      "kopi @chatbotfinance2",
      "mail me a@chatbotfinance",
      "@@chatbotfinance",
      "",
    ])
      expect(g(t).addressed).toBe(false);
    expect(g("kopi 25rb @budi")).toEqual({ addressed: false, text: "kopi 25rb @budi" });
    expect(g(null)).toEqual({ addressed: false, text: "" });
  });

  it("accepts a bare username with a leading @", () => {
    expect(groupAddress({ text: "kopi @MyBot", chatType: "group", botUsername: "@mybot" })).toEqual(
      {
        addressed: true,
        text: "kopi",
      },
    );
  });

  it("commands: no target or this bot only", () => {
    expect(g("/saldo")).toEqual({ addressed: true, text: "/saldo" });
    expect(g("/saldo@chatbotfinance")).toEqual({ addressed: true, text: "/saldo@chatbotfinance" });
    expect(g("/saldo@ChatBotFinance bulan ini").text).toBe("/saldo@ChatBotFinance bulan ini");
    expect(g("/saldo@OtherBot").addressed).toBe(false);
    expect(g("/saldo@OtherBot", { replyToBot: true }).addressed).toBe(false);
  });

  it("replies to the bot are addressed, including images without caption", () => {
    expect(g("Kopi susu", { replyToBot: true })).toEqual({ addressed: true, text: "Kopi susu" });
    expect(g(null, { replyToBot: true })).toEqual({ addressed: true, text: "" });
    expect(g("Kopi @chatbotfinance", { replyToBot: true }).text).toBe("Kopi");
  });

  it("falls back to any @…bot mention when the username is unknown", () => {
    const u = (text: string) => groupAddress({ text, chatType: "group" });
    expect(u("kopi 25rb @dompetku_bot")).toEqual({ addressed: true, text: "kopi 25rb" });
    expect(u("kopi 25rb @DompetBot")).toEqual({ addressed: true, text: "kopi 25rb" });
    expect(u("kopi 25rb @budi").addressed).toBe(false);
    expect(u("/saldo@dompetku_bot").addressed).toBe(true);
    expect(u("/saldo@budi").addressed).toBe(false);
    expect(u("/saldo").addressed).toBe(true);
  });
});
