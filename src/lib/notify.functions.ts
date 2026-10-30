import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./auth-middleware";
import { notifyRecipientSchema } from "./notify";

/**
 * Settings → Pengguna → Notifikasi (v22, admin only; disabled on demo instances). Members never
 * set their own chat id or wallet subset: the scope is always recomputed from account_permissions.
 */
export const getNotifySettingsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listNotifySettings } = await import("./notify.server");
    return listNotifySettings();
  });

export const saveNotifySettingsFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => notifyRecipientSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { saveNotifySettings } = await import("./notify.server");
    return saveNotifySettings(data);
  });

export const deleteNotifySettingsFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { deleteNotifySettings } = await import("./notify.server");
    return deleteNotifySettings(data.user_id);
  });
