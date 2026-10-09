import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { readValidSession } = await import("./session.server");
  const s = await readValidSession();
  return { authenticated: !!s, user: s?.u ?? null };
});

const passwordStep = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
const totpStep = z.object({
  challenge: z.string().min(1).max(600),
  code: z.string().min(1).max(20),
});

/**
 * Login. Without APP_TOTP_SECRET it is a single password step. With it, the
 * password step returns `needTotp` + a 5-minute signed challenge, and only a
 * second call with that challenge and a valid code creates the session.
 */
export const login = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.union([passwordStep, totpStep]).parse(d))
  .handler(async ({ data }) => {
    const {
      checkCredentials,
      createSession,
      createLoginChallenge,
      readLoginChallenge,
      sessionVersionFor,
    } = await import("./session.server");
    const { configuredTotpSecret, verifyLoginTotp } = await import("./totp.server");
    const { logActivity } = await import("./finance.server");
    const { recentLoginFailures, noteLoginFailure } = await import("./login-throttle.server");
    const { isLoginLocked } = await import("./login-throttle");
    const slow = () => new Promise((r) => setTimeout(r, 600));
    if (isLoginLocked(await recentLoginFailures())) {
      await slow();
      return { ok: false as const, locked: true as const };
    }
    const { isDemo } = await import("./demo.server");
    // Demo instances publish their login; 2FA is never enforced there.
    const totpOn = !isDemo() && configuredTotpSecret() !== null;

    if ("challenge" in data) {
      const username = totpOn ? readLoginChallenge(data.challenge) : null;
      if (!username) {
        await slow();
        return { ok: false as const, locked: false as const, expired: true as const };
      }
      if (!verifyLoginTotp(data.code)) {
        noteLoginFailure();
        await logActivity("auth.login_failed", "auth", { name: username.slice(0, 60) });
        await slow();
        return { ok: false as const, locked: false as const, badCode: true as const };
      }
      createSession(username, await sessionVersionFor(username));
      await logActivity("auth.login", "auth", { name: username.slice(0, 60) });
      return { ok: true as const };
    }

    if (!(await checkCredentials(data.username, data.password))) {
      noteLoginFailure();
      await logActivity("auth.login_failed", "auth", { name: data.username.slice(0, 60) });
      await slow();
      return { ok: false as const, locked: false as const };
    }
    if (totpOn) {
      return {
        ok: false as const,
        locked: false as const,
        needTotp: true as const,
        challenge: createLoginChallenge(data.username),
      };
    }
    createSession(data.username, await sessionVersionFor(data.username));
    await logActivity("auth.login", "auth", { name: data.username.slice(0, 60) });
    return { ok: true as const };
  });

/** Whether two-step login is active. Never returns the configured secret. */
export const getTwoFactorStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => {
    const { configuredTotpSecret } = await import("./totp.server");
    if ((await import("./demo.server")).isDemo()) return { active: false, invalid: false };
    const invalid = !!process.env["APP_TOTP_SECRET"]?.trim() && configuredTotpSecret() === null;
    return { active: configuredTotpSecret() !== null, invalid };
  });

/** Generates a fresh secret for enrollment; refused while 2FA is already active. */
export const generateTwoFactorSecret = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { configuredTotpSecret, generateTotpSecret } = await import("./totp.server");
    const { buildOtpauthUri } = await import("./totp");
    (await import("./demo.server")).assertNotDemo();
    if (configuredTotpSecret() !== null) throw new Error("2FA sudah aktif.");
    const secret = generateTotpSecret();
    return {
      secret,
      uri: buildOtpauthUri({ secret, account: context.user, issuer: "Dompetku" }),
    };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { destroySession } = await import("./session.server");
  destroySession();
  const { logActivity } = await import("./finance.server");
  await logActivity("auth.logout", "auth", null);
  return { ok: true };
});
