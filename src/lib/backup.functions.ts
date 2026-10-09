import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";
import { REPLACE_CONFIRM_WORD, RESTORE_CHUNK_ROWS, RESTORE_TABLES } from "./backup";

/**
 * Restore a backup in steps so each request stays far below Vercel's 4.5 MB body limit
 * (a whole backup may be up to ~20 MB, see MAX_BACKUP_BYTES):
 *   { step: "clear", mode: "replace", confirm }  → delete current data (reverse FK order)
 *   { step: "chunk", mode, table, rows, remap }  → upsert ≤ 500 rows (≤ 2 MB) of one table
 *   { step: "finish", mode, restored, tables, skipped } → activity log `backup.restore`
 */
const mode = z.enum(["merge", "replace"]).default("merge");
const remap = z.record(z.string(), z.record(z.string(), z.string())).default({});

const restoreInput = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("clear"),
    mode: z.literal("replace"),
    confirm: z.literal(REPLACE_CONFIRM_WORD),
  }),
  z.object({
    step: z.literal("chunk"),
    mode,
    table: z.enum(RESTORE_TABLES),
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(RESTORE_CHUNK_ROWS),
    remap,
  }),
  z.object({
    step: z.literal("finish"),
    mode,
    restored: z.number().int().min(0),
    tables: z.number().int().min(0),
    skipped: z.array(z.string().max(60)).max(30),
  }),
]);

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => restoreInput.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const srv = await import("./backup.server");
    if (data.step === "clear") return { step: "clear" as const, ...(await srv.clearForReplace()) };
    if (data.step === "chunk") {
      const r = await srv.restoreChunk(data.table, data.rows, data.remap);
      return { step: "chunk" as const, ...r };
    }
    await srv.finishRestore({
      mode: data.mode,
      restored: data.restored,
      tables: data.tables,
      skipped: data.skipped,
    });
    return { step: "finish" as const, ok: true };
  });
