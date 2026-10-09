import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/report?period=today|yesterday|week|lastweek|month|lastmonth|YYYY-MM|YYYY-MM-DD
export const Route = createFileRoute("/api/public/n8n/report")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:report", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        const period = (new URL(request.url).searchParams.get("period") ?? "month").slice(0, 20);
        try {
          const { reportData, reportText } = await import("@/lib/bot.server");
          const data = await reportData(period);
          if (!data) return json({ ok: false, error: "Periode tidak dikenali" }, 400);
          return json({ ok: true, ...data, message: await reportText(period) });
        } catch (e) {
          await reportServerError("n8n:report", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
