import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth-middleware";
import { myNotifySchema, notifyRecipientSchema, selfNotifyUserId } from "./notify";

/**
 * Settings → Pengguna → Notifikasi (v22, admin only; disabled on demo instances). Members manage
 * only their OWN row via the `*MyNotify*` fns below (#122); the scope is always recomputed from
 * account_permissions.
 */
export const getNotifySettingsFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listNotifySettings } = await import("./notify.server");
    return listNotifySettings({ setBy: true });
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

/**
 * Profile → Notifikasi Telegram (#122): the signed-in MEMBER's own row. The user id always comes
 * from the session (never input); the owner is refused (`accountScope` null → uses
 * TELEGRAM_ADMIN_CHAT_ID in Settings → Integrasi). Chat ids never grant bot access.
 */
export const getMyNotifyFn = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { accountScope } = await import("./rbac.server");
    const userId = selfNotifyUserId(accountScope(context), context.userId);
    const { getMyNotify } = await import("./notify.server");
    return getMyNotify(userId);
  });

export const saveMyNotifyFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => myNotifySchema.parse(d))
  .handler(async ({ data, context }) => {
    (await import("./demo.server")).assertNotDemo();
    const { accountScope } = await import("./rbac.server");
    const userId = selfNotifyUserId(accountScope(context), context.userId);
    const { saveMyNotify } = await import("./notify.server");
    return saveMyNotify(userId, data);
  });
