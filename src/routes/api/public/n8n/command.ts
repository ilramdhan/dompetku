import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";
import { z } from "zod";

// POST /api/public/n8n/command — { text: "saldo" } → perintah bot: saldo, laporan, pengingat, sudah bayar <nama>
const schema = z.object({
  text: z.string().min(1).max(500),
});

export const Route = createFileRoute("/api/public/n8n/command")({
  server: {
    handlers: {
      POST: withErrorLogging("n8n:command", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
        try {
          const { botCommand } = await import("@/lib/finance.server");
          const r = await botCommand(parsed.data.text);
          return json({ ok: true, ...r });
        } catch (e) {
          await reportServerError("n8n:command", e, request);
          return json(
            {
              ok: false,
              error: e instanceof Error ? e.message : "Gagal",
              message: "⚠️ Gagal memproses perintah.",
            },
            500,
          );
        }
      }),
    },
  },
});
