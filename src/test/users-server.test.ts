/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed DB fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let row: any = null;
let failWith: { message: string; code?: string } | null = null;
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: (table: string) => {
      const api: any = {
        select: () => api,
        insert: () => api,
        eq: () => api,
        maybeSingle: () => api,
        then: (res: (v: any) => void) =>
          res(
            table === "app_users"
              ? failWith
                ? { data: null, error: failWith }
                : { data: row, error: null }
              : { data: null, error: null },
          ),
      };
      return api;
    },
  }),
}));

import { hashPassword } from "@/lib/password.server";
import {
  checkCredentials,
  clearSessionVersionCache,
  currentSessionVersion,
} from "@/lib/users.server";

const ENV = ["APP_USERNAME", "APP_PASSWORD", "APP_PASSWORD_RESET"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  row = null;
  failWith = null;
  process.env["APP_USERNAME"] = "me";
  process.env["APP_PASSWORD"] = "env-password-123";
  delete process.env["APP_PASSWORD_RESET"];
  clearSessionVersionCache();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("checkCredentials", () => {
  it("uses APP_PASSWORD without a row or table", async () => {
    expect(await checkCredentials("me", "env-password-123")).toBe(true);
    expect(await checkCredentials("me", "wrong")).toBe(false);
    expect(await checkCredentials("other", "env-password-123")).toBe(false);
    failWith = { message: "Could not find the table 'public.app_users'", code: "PGRST205" };
    expect(await checkCredentials("me", "env-password-123")).toBe(true);
  });

  it("prefers the DB hash once set; env password stops working", async () => {
    row = {
      id: "1",
      username: "me",
      password_hash: await hashPassword("db-password-456", { N: 2 ** 14, r: 8, p: 1 }),
      session_version: 2,
    };
    expect(await checkCredentials("me", "db-password-456")).toBe(true);
    expect(await checkCredentials("me", "env-password-123")).toBe(false);
  });

  it("APP_PASSWORD_RESET=true restores the env password", async () => {
    row = {
      id: "1",
      username: "me",
      password_hash: await hashPassword("db-password-456", { N: 2 ** 14, r: 8, p: 1 }),
      session_version: 2,
    };
    process.env["APP_PASSWORD_RESET"] = "true";
    expect(await checkCredentials("me", "env-password-123")).toBe(true);
    expect(await checkCredentials("me", "db-password-456")).toBe(false);
  });

  it("refuses login on an unknown DB error instead of guessing", async () => {
    failWith = { message: "connection reset" };
    expect(await checkCredentials("me", "env-password-123")).toBe(false);
  });
});

describe("currentSessionVersion", () => {
  it("is null without a row/table and caches the row value", async () => {
    expect(await currentSessionVersion("me", 0)).toBeNull();
    clearSessionVersionCache();
    row = { session_version: 3 };
    expect(await currentSessionVersion("me", 0)).toBe(3);
    row = { session_version: 4 };
    expect(await currentSessionVersion("me", 10_000)).toBe(3); // cached
    expect(await currentSessionVersion("me", 60_000)).toBe(4); // expired
  });
  it("keeps the last known value on a transient error", async () => {
    row = { session_version: 2 };
    expect(await currentSessionVersion("me", 0)).toBe(2);
    failWith = { message: "timeout" };
    expect(await currentSessionVersion("me", 60_000)).toBe(2);
  });
});
