import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./auth-middleware";
import { changePasswordSchema, profileInputSchema } from "./profile";

/** Logged-in user's profile (v17 row, or env user with empty fields). */
export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const { getProfileState } = await import("./users.server");
    return getProfileState(context.user);
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .inputValidator((d: unknown) => profileInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    (await import("./demo.server")).assertNotDemo();
    const { saveProfile } = await import("./users.server");
    return saveProfile(context.user, data, context.role);
  });

/**
 * Changes the password. On success the session_version is bumped (other devices are logged
 * out) and this device gets a fresh cookie carrying the new version.
 */
export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .inputValidator((d: unknown) => changePasswordSchema.parse(d))
  .handler(async ({ data, context }) => {
    (await import("./demo.server")).assertNotDemo();
    const { recentLoginFailures, noteLoginFailure } = await import("./login-throttle.server");
    const { isLoginLocked } = await import("./login-throttle");
    if (isLoginLocked(await recentLoginFailures()))
      return {
        ok: false as const,
        error: "Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam 15 menit.",
      };
    const users = await import("./users.server");
    const res = await users.changePassword(context.user, data.current, data.next, context.role);
    if (!res.ok) {
      if (res.error === "Password saat ini salah") {
        // Wrong current password counts toward the login throttle (guards a stolen session).
        noteLoginFailure();
        const { logActivity } = await import("./finance.server");
        await logActivity("auth.login_failed", "auth", { name: "password_change" });
        await new Promise((r) => setTimeout(r, 600));
      }
      return { ok: false as const, error: res.error };
    }
    const { createSession } = await import("./session.server");
    createSession(
      context.user,
      res.session_version,
      context.role === "member" ? context.userId : null,
    );
    return { ok: true as const };
  });
