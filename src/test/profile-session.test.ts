import { describe, expect, it } from "vitest";
import { parseSessionData, sessionVersionValid } from "@/lib/session";
import { initials, profileInputSchema, resolveProfile } from "@/lib/profile";
import { RESTORE_TABLES, stripGenerated, stripSecrets, KEEP_ON_REPLACE } from "@/lib/backup";

const NOW = 1_700_000_000_000;

describe("session payload", () => {
  it("accepts legacy cookies without sv", () => {
    expect(parseSessionData({ u: "me", exp: NOW + 1 }, NOW)).toEqual({ u: "me", exp: NOW + 1 });
  });
  it("keeps a valid sv", () => {
    expect(parseSessionData({ u: "me", exp: NOW + 1, sv: 3 }, NOW)).toEqual({
      u: "me",
      exp: NOW + 1,
      sv: 3,
    });
  });
  it("rejects expired, malformed or bad sv", () => {
    expect(parseSessionData({ u: "me", exp: NOW - 1 }, NOW)).toBeNull();
    expect(parseSessionData({ exp: NOW + 1 }, NOW)).toBeNull();
    expect(parseSessionData({ u: "me", exp: NOW + 1, sv: 0 }, NOW)).toBeNull();
    expect(parseSessionData({ u: "me", exp: NOW + 1, sv: "2" }, NOW)).toBeNull();
    expect(parseSessionData(null, NOW)).toBeNull();
  });
  it("checks the session version with back-compat", () => {
    expect(sessionVersionValid(undefined, null)).toBe(true); // no row / no table
    expect(sessionVersionValid(5, null)).toBe(true);
    expect(sessionVersionValid(undefined, 1)).toBe(true); // pre-v17 cookie, never changed
    expect(sessionVersionValid(undefined, 2)).toBe(false); // password changed since
    expect(sessionVersionValid(2, 2)).toBe(true);
    expect(sessionVersionValid(1, 2)).toBe(false);
  });
});

describe("profile", () => {
  it("resolves env user without a row, owner always admin", () => {
    expect(resolveProfile("me", null, true)).toEqual({
      username: "me",
      display_name: null,
      address: null,
      avatar: null,
      role: "admin",
      updated_at: null,
    });
    const p = resolveProfile(
      "me",
      { display_name: " Ilham ", avatar: "data:text/html;base64,AAAA", role: "member" },
      true,
    );
    expect(p.display_name).toBe("Ilham");
    expect(p.avatar).toBeNull();
    expect(p.role).toBe("admin");
  });
  it("builds initials", () => {
    expect(initials("Ilham Ramadhan")).toBe("IR");
    expect(initials(null, "ilham")).toBe("IL");
    expect(initials("", "john_doe")).toBe("JD");
    expect(initials(null, "")).toBe("?");
  });
  it("validates input", () => {
    expect(profileInputSchema.parse({ display_name: " ", address: "", avatar: null })).toEqual({
      display_name: null,
      address: null,
      avatar: null,
    });
    expect(() =>
      profileInputSchema.parse({
        display_name: null,
        address: null,
        avatar: "data:image/svg+xml;base64,AA==",
      }),
    ).toThrow();
    expect(() =>
      profileInputSchema.parse({ display_name: "x".repeat(81), address: null, avatar: null }),
    ).toThrow();
  });
});

describe("backup of app_users", () => {
  it("is restorable but never carries credentials", () => {
    expect(RESTORE_TABLES).toContain("app_users");
    expect(KEEP_ON_REPLACE).toContain("app_users");
    const row = { id: "1", username: "me", password_hash: "scrypt$…", session_version: 4 };
    expect(stripSecrets("app_users", [row])).toEqual([{ id: "1", username: "me" }]);
    expect(stripGenerated("app_users", [row])).toEqual([{ id: "1", username: "me" }]);
    expect(stripSecrets("accounts", [row])).toEqual([row]);
  });
});
