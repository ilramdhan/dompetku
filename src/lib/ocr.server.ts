import { draftSchema, type Draft } from "./schemas";
import { isValidDate, matchCategory } from "./bot";
import { usageFromResponse } from "./ai-usage";
import type { AiMeta } from "./ai-usage.server";

/** What the model may pick from. Names only — never the "(expense)" suffix, which models echo back. */
export type ParseContext = { income: string[]; expense: string[]; accounts?: string[] };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Short, secret-free provider message (OpenAI `{error:{message}}` or Gemini `[{error:{message}}]`). */
export function aiErrorReason(body: string): string | null {
  let msg: unknown;
  try {
    const j: any = JSON.parse(body);
    msg = (Array.isArray(j) ? j[0] : j)?.error?.message;
  } catch {
    return null;
  }
  if (typeof msg !== "string" || !msg.trim()) return null;
  return msg
    .replace(/(key=|Bearer\s+)[^\s&"']+/gi, "$1***")
    .replace(/\b(sk-|AIza)[\w-]{8,}/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

const WEB: AiMeta = { source: "web" };

/** Records the call in `ai_usage` (v15); never throws and never delays the caller on failure. */
async function record(meta: AiMeta, vision: boolean, model: string, ok: boolean, body?: unknown) {
  try {
    const { recordAiUsage } = await import("./ai-usage.server");
    await recordAiUsage({
      meta,
      kind: vision ? "vision" : "text",
      model,
      ok,
      ...usageFromResponse(body),
    });
  } catch {
    // recordAiUsage already logs; importing it should never fail a parse.
  }
}

async function aiJson(messages: unknown[], vision: boolean, meta: AiMeta = WEB): Promise<unknown> {
  const url = process.env["AI_API_URL"] || "https://ai.gateway.lovable.dev/v1/chat/completions";
  const key = process.env["AI_API_KEY"] || process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI_API_KEY belum diatur untuk fitur OCR.");
  const base = process.env["AI_MODEL"] || "google/gemini-2.5-flash";
  // AI_MODEL_TEXT lets chat parsing use a cheaper model (e.g. flash-lite) than receipt OCR.
  const model = vision ? base : process.env["AI_MODEL_TEXT"] || base;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    await record(meta, vision, model, false);
    throw e;
  }
  if (!res.ok) {
    const body = await res.text();
    await record(meta, vision, model, false);
    console.error(`AI request failed [${res.status}] model=${model}: ${body.slice(0, 500)}`);
    if (res.status === 429) throw new Error("Batas pemakaian AI tercapai, coba lagi sebentar.");
    if (res.status === 402) throw new Error("Kredit AI habis.");
    const reason = aiErrorReason(body);
    throw new Error(`Gagal membaca dengan AI [${res.status}]${reason ? `: ${reason}` : "."}`);
  }
  let j: any;
  try {
    j = await res.json();
  } catch (e) {
    await record(meta, vision, model, false);
    throw e;
  }
  await record(meta, vision, model, true, j);
  const content: string = j?.choices?.[0]?.message?.content ?? "{}";
  const m = content.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m ? m[0] : content);
  } catch {
    return {};
  }
}

function shape(ctx: ParseContext): string {
  const acc = ctx.accounts?.length
    ? ` "account":string|null (pilih persis dari: ${ctx.accounts.join(", ")}; null jika tidak disebut),`
    : "";
  return `Balas HANYA JSON: {"kind":"expense"|"income","amount":number,"currency":"IDR"|"USD","merchant":string|null,"date":"YYYY-MM-DD"|null,"category":string|null,${acc}"description":string|null,"items":[{"name":string,"qty":number|null,"price":number|null}]}. amount = total akhir yang dibayar (angka murni). category WAJIB persis salah satu nama berikut. Pengeluaran: ${ctx.expense.join(", ")}. Pemasukan: ${ctx.income.join(", ")}.`;
}

/** Snap model output onto real categories/accounts so the AI can never invent new ones. */
function normalize(d: Draft, ctx: ParseContext): Draft {
  const list = d.kind === "income" ? ctx.income : ctx.expense;
  const category = matchCategory(d.category, list) ?? matchCategory("Lainnya", list) ?? null;
  const account =
    d.account && ctx.accounts
      ? (ctx.accounts.find((a) => a.toLowerCase() === d.account!.toLowerCase()) ?? null)
      : null;
  return {
    ...d,
    category,
    account,
    date: d.date && isValidDate(d.date) ? d.date : null,
  };
}

export async function parseReceipt(
  imageDataUrl: string,
  ctx: ParseContext,
  meta: AiMeta = WEB,
): Promise<Draft> {
  (await import("./demo.server")).assertNotDemo();
  const out = await aiJson(
    [
      {
        role: "system",
        content: `Kamu membaca foto nota/struk belanja Indonesia. Jika bukan nota, amount=0. Batasi items maks 30. ${shape(ctx)}`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Ekstrak data transaksi dari nota ini." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    true,
    meta,
  );
  return normalize(draftSchema.parse(out), ctx);
}

export async function parseText(
  text: string,
  ctx: ParseContext,
  today: string,
  meta: AiMeta = WEB,
): Promise<Draft> {
  (await import("./demo.server")).assertNotDemo();
  const out = await aiJson(
    [
      {
        role: "system",
        content: `Ubah pesan chat singkat Bahasa Indonesia jadi transaksi. "rb"/"k"=ribu, "jt"=juta. Hari ini ${today}. items=[] kecuali disebut rinci. ${shape(ctx)}`,
      },
      { role: "user", content: text.slice(0, 1000) },
    ],
    false,
    meta,
  );
  return normalize(draftSchema.parse(out), ctx);
}
