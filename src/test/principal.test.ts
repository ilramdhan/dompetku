/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
let users: Record<string, any> = {};
let grants: any[] = [];
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: (table: string) => {
      let key: string | null = null;
      const api: any = {
        select: () => api,
        eq: (_c: string, v: string) => ((key = v), api),
        maybeSingle: () => api,
        then: (res: (v: any) => void) =>
          res(
            table === "app_users"
              ? { data: (key && users[key]) ?? null, error: null }
              : table === "account_permissions"
                ? { data: grants, error: null }
                : { data: null, error: null },
          ),
      };
      return api;
    },
  }),
}));

import { hashPassword } from "@/lib/password.server";
import {
  authenticate,
  clearSessionVersionCache,
  forgetMember,
  resolvePrincipal,
} from "@/lib/users.server";

beforeEach(async () => {
  process.env["APP_USERNAME"] = "me";
  process.env["APP_PASSWORD"] = "env-password-123";
  delete process.env["APP_PASSWORD_RESET"];
  users = {
    anak: {
      id: "u1",
      username: "anak",
      role: "member",
      is_active: true,
      session_version: 3,
      must_change_password: false,
      password_hash: await hashPassword("member-pass-1234", { N: 2 ** 14, r: 8, p: 1 }),
    },
  };
  grants = [{ account_id: A, level: "view" }];
  clearSessionVersionCache();
  forgetMember();
});

describe("resolvePrincipal", () => {
  it("keeps legacy owner cookies working without a row", async () => {
    const p = await resolvePrincipal({ u: "me" });
    expect(p?.role).toBe("admin");
    expect(p?.access.role).toBe("admin");
  });
  it("never reads a member cookie as the owner or vice versa", async () => {
    expect(await resolvePrincipal({ u: "me", sv: 1, r: "member" })).toBeNull();
    expect(await resolvePrincipal({ u: "anak", sv: 3 })).toBeNull();
  });
  it("resolves an active member with grants and checks session_version", async () => {
    const p = await resolvePrincipal({ u: "anak", sv: 3, r: "member" });
    expect(p?.role).toBe("member");
    expect(p?.access.grants).toEqual({ [A]: "view" });
    forgetMember();
    expect(await resolvePrincipal({ u: "anak", sv: 2, r: "member" })).toBeNull();
    expect(await resolvePrincipal({ u: "anak", r: "member" })).toBeNull();
  });
  it("refuses inactive members and admin rows behind member cookies", async () => {
    users["anak"].is_active = false;
    expect(await resolvePrincipal({ u: "anak", sv: 3, r: "member" })).toBeNull();
    users["anak"].is_active = true;
    users["anak"].role = "admin";
    forgetMember();
    expect(await resolvePrincipal({ u: "anak", sv: 3, r: "member" })).toBeNull();
  });
});

describe("authenticate", () => {
  it("logs in owner and active members only", async () => {
    expect(await authenticate("me", "env-password-123")).toEqual({
      ok: true,
      role: "admin",
      username: "me",
    });
    expect(await authenticate("Anak", "member-pass-1234")).toMatchObject({
      ok: true,
      role: "member",
      username: "anak",
      sv: 3,
    });
    expect((await authenticate("anak", "wrong-password")).ok).toBe(false);
    expect((await authenticate("ghost", "member-pass-1234")).ok).toBe(false);
    users["anak"].is_active = false;
    expect((await authenticate("anak", "member-pass-1234")).ok).toBe(false);
  });
});
