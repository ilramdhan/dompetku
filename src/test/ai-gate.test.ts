import { describe, expect, it } from "vitest";
import { aiTextGate, BOT_AI_TEXT_MAX, hasAmountSignal } from "@/lib/bot";

describe("hasAmountSignal", () => {
  it("digits always count", () => {
    expect(hasAmountSignal("bayar listrik 350rb")).toBe(true);
    expect(hasAmountSignal("tgl 5")).toBe(true);
  });

  it("Indonesian number words and money slang, case-insensitive", () => {
    for (const t of [
      "beli kopi dua puluh ribu",
      "makan siang goceng",
      "parkir Seceng",
      "jajan CEBAN",
      "gaji sepuluh JUTA",
      "sewa sejuta",
      "pulsa seratus",
      "permen gopek",
      "tip cepek",
      "sebelas ribu buat bensin",
      "dapat setengah juta",
    ])
      expect(hasAmountSignal(t), t).toBe(true);
  });

  it("whole words only", () => {
    expect(hasAmountSignal("halo")).toBe(false);
    expect(hasAmountSignal("test")).toBe(false);
    expect(hasAmountSignal("apa kabar")).toBe(false);
    expect(hasAmountSignal("selamat pagi")).toBe(false);
    // "dua" inside a word, "rb" inside a word
    expect(hasAmountSignal("duapan herbal")).toBe(false);
    expect(hasAmountSignal("terima kasih ya")).toBe(false);
  });
});

describe("aiTextGate", () => {
  it("greetings and chit-chat never reach AI", () => {
    for (const t of ["halo", "test", "apa kabar", "makasih", "  ", "ok sip"])
      expect(aiTextGate(t), t).toEqual({ ok: false, reason: "no_amount" });
  });

  it("texts with an amount signal may use AI", () => {
    for (const t of [
      "beli kopi dua puluh ribu",
      "makan siang goceng",
      "bayar listrik 350rb",
      "kemarin patungan sama andi 120rb",
    ])
      expect(aiTextGate(t), t).toEqual({ ok: true });
  });

  it("over-long text is refused even with an amount", () => {
    const long = `bayar 50rb ${"x".repeat(BOT_AI_TEXT_MAX)}`;
    expect(aiTextGate(long)).toEqual({ ok: false, reason: "too_long" });
    expect(aiTextGate("a".repeat(BOT_AI_TEXT_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("the limit is inclusive and measured after trimming", () => {
    const exact = `kopi 25rb ${"x".repeat(BOT_AI_TEXT_MAX - 10)}`;
    expect(exact.length).toBe(BOT_AI_TEXT_MAX);
    expect(aiTextGate(`  ${exact}  `)).toEqual({ ok: true });
  });
});
