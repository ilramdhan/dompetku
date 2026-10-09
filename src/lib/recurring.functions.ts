import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";

const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

/** Rows for the recurring page; `ready: false` before schema v10 is run. */
export const getRecurring = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listRecurring } = await import("./recurring.server");
    return listRecurring();
  });

/** "Catat sekarang" — record the current occurrence and advance next_due. */
export const postRecurring = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), date: optDate }).parse(d))
  .handler(async ({ data }) => {
    const { postRecurringNow } = await import("./recurring.server");
    return postRecurringNow(data.id, data.date ?? null);
  });

/** Pause / resume a recurring item. */
export const toggleRecurring = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { setRecurringActive } = await import("./recurring.server");
    return setRecurringActive(data.id, data.active);
  });
