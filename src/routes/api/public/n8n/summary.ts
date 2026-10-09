import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/summary?month=YYYY-MM — monthly report (defaults to current month).
export const Route = createFileRoute("/api/public/n8n/summary")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:summary", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        try {
          const { computeDashboard, summaryText, today } = await import("@/lib/finance.server");
          const q = new URL(request.url).searchParams.get("month");
          const month = q && /^\d{4}-\d{2}$/.test(q) ? q : today().slice(0, 7);
          const d = await computeDashboard(month);
          return json({
            ok: true,
            month,
            income: d.income,
            expense: d.expense,
            net: d.net,
            total_balance_idr: d.totalBalanceIdr,
            debt_outstanding_idr: d.debtOutstandingIdr,
            by_category: d.byCategory,
            message: await summaryText(month),
          });
        } catch (e) {
          await reportServerError("n8n:summary", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
