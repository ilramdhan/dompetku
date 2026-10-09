import { createFileRoute } from "@tanstack/react-router";
import { reportServerError, withErrorLogging } from "@/lib/monitoring";

// GET /api/public/n8n/backup — full JSON backup (same format as Settings → Unduh cadangan).
// Response: { ok, filename, exportedAt, app, version, data } plus a Content-Disposition filename hint.
// Strip `ok`/`filename` or keep them — restore ignores unknown top-level fields.
export const Route = createFileRoute("/api/public/n8n/backup")({
  server: {
    handlers: {
      GET: withErrorLogging("n8n:backup", async ({ request }) => {
        const { checkApiKey, json } = await import("@/lib/api-key.server");
        const denied = await checkApiKey(request);
        if (denied) return denied;
        try {
          const { exportBackup } = await import("@/lib/finance.server");
          const { backupFilename } = await import("@/lib/backup");
          const backup = await exportBackup();
          const filename = backupFilename(new Date(backup.exportedAt));
          const res = json({ ok: true, filename, ...backup });
          res.headers.set("Content-Disposition", `attachment; filename="${filename}"`);
          return res;
        } catch (e) {
          await reportServerError("n8n:backup", e, request);
          return json({ ok: false, error: e instanceof Error ? e.message : "Gagal" }, 500);
        }
      }),
    },
  },
});
