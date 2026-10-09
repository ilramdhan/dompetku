import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";
import { z } from "zod";
import { externalTxSchema } from "@/lib/schemas";

// POST /api/public/n8n/transactions — body: one transaction object or an array of them.
export const Route = createFileRoute("/api/public/n8n/transactions")({
  server: {
    handlers: {
      POST: withErrorLogging("n8n:transactions", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const body = await request.json().catch(() => null);
        const parsed = z
          .union([externalTxSchema, z.array(externalTxSchema).max(100)])
          .safeParse(body);
        if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
        try {
          const { createFromExternal } = await import("@/lib/finance.server");
          const list = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
          const results = [];
          for (const t of list) results.push(await createFromExternal(t));
          return json({
            ok: true,
            count: results.length,
            results,
            message: results.map((r) => r.message).join("\n"),
          });
        } catch (e) {
          await reportServerError("n8n:transactions", e, request);
          return json(
            { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan" },
            500,
          );
        }
      }),
    },
  },
});
