import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";
import { z } from "zod";

// POST /api/public/n8n/ocr — { image_base64, mime_type?: "image/jpeg", save?: true, source?: "telegram", account?: "BCA" }
const schema = z.object({
  // Vercel membatasi body request 4,5 MB → batasi base64 di bawah itu.
  image_base64: z.string().min(100).max(4_400_000),
  mime_type: z
    .string()
    .regex(/^image\/[a-z+.-]+$/)
    .default("image/jpeg"),
  save: z.boolean().default(true),
  source: z.enum(["telegram", "whatsapp", "n8n", "ocr"]).default("ocr"),
  account: z.string().max(80).nullable().optional(),
  external_id: z.string().max(120).nullable().optional(),
});

export const Route = createFileRoute("/api/public/n8n/ocr")({
  server: {
    handlers: {
      POST: withErrorLogging("n8n:ocr", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
        try {
          const { parseReceipt } = await import("@/lib/ocr.server");
          const { parseContext, createFromExternal } = await import("@/lib/finance.server");
          const b64 = parsed.data.image_base64.replace(/^data:[^,]+,/, "");
          const draft = await parseReceipt(
            `data:${parsed.data.mime_type};base64,${b64}`,
            await parseContext(),
          );
          if (!draft.amount || draft.amount <= 0)
            return json(
              { ok: false, draft, message: "❓ Total nota tidak terbaca, coba foto lebih jelas." },
              422,
            );
          if (!parsed.data.save) return json({ ok: true, draft });
          const r = await createFromExternal({
            kind: draft.kind,
            amount: draft.amount,
            currency: draft.currency,
            category: draft.category,
            account: parsed.data.account ?? draft.account ?? null,
            description: draft.description,
            merchant: draft.merchant,
            date: draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : null,
            source: parsed.data.source,
            items: draft.items.length ? draft.items : null,
            raw: { ocr: draft },
            external_id: parsed.data.external_id ?? null,
          });
          return json({ ok: true, draft, ...r });
        } catch (e) {
          await reportServerError("n8n:ocr", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
