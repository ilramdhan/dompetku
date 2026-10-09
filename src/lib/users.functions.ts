import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./auth-middleware";
import {
  createMemberSchema,
  permissionsSchema,
  resetPasswordSchema,
  updateMemberSchema,
} from "./users";
import { z } from "zod";

/**
 * Settings → Pengguna (v18). Admin only; disabled on demo instances. The owner (APP_USERNAME)
 * is listed but can never be changed here: every mutation refuses non-member rows server-side.
 */
export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listUsers } = await import("./users.server");
    return listUsers();
  });

export const createMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => createMemberSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { createMember } = await import("./users.server");
    return createMember(data);
  });

export const updateMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => updateMemberSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { updateMember } = await import("./users.server");
    return updateMember(data);
  });

export const resetMemberPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => resetPasswordSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { resetMemberPassword } = await import("./users.server");
    return resetMemberPassword(data.id, data.password);
  });

export const deleteMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { deleteMember } = await import("./users.server");
    return deleteMember(data.id);
  });

export const setMemberPermissionsFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => permissionsSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { setMemberPermissions } = await import("./users.server");
    return setMemberPermissions(data.id, data.grants);
  });
