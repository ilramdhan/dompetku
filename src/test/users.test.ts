import { describe, expect, it } from "vitest";
import {
  createMemberSchema,
  dedupeGrants,
  displayNameOf,
  grantsFromMatrix,
  normalizeUsername,
  usernameProblems,
} from "@/lib/users";
import { parseSessionData } from "@/lib/session";
import { RESTORE_TABLES } from "@/lib/backup";
import { activityLabel } from "@/lib/activity";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("member usernames", () => {
  it("normalizes and validates", () => {
    expect(normalizeUsername("  Anak.Satu ")).toBe("anak.satu");
    expect(usernameProblems("anak", "me")).toEqual([]);
    expect(usernameProblems("ab", "me")).toHaveLength(1);
    expect(usernameProblems("bad name", "me")).toHaveLength(1);
    expect(usernameProblems("ME", "me")).toContain("Username sudah dipakai");
  });
  it("display name falls back to the username", () => {
    expect(displayNameOf({ display_name: " Budi ", username: "budi" })).toBe("Budi");
    expect(displayNameOf({ display_name: "  ", username: "budi" })).toBe("budi");
    expect(
      createMemberSchema.parse({ username: "x", display_name: "", password: "p" }).display_name,
    ).toBeNull();
  });
});

describe("permission matrix", () => {
  it("drops none and dedupes", () => {
    expect(grantsFromMatrix({ [A]: "view", [B]: "none" })).toEqual([
      { account_id: A, level: "view" },
    ]);
    expect(
      dedupeGrants([
        { account_id: A, level: "view" },
        { account_id: A, level: "manage" },
      ]),
    ).toEqual([{ account_id: A, level: "manage" }]);
  });
});

describe("member cookies", () => {
  it("accepts r=member only", () => {
    const exp = Date.now() + 1000;
    expect(parseSessionData({ u: "anak", exp, sv: 2, r: "member" })).toEqual({
      u: "anak",
      exp,
      sv: 2,
      r: "member",
    });
    expect(parseSessionData({ u: "anak", exp, r: "admin" })).toBeNull();
  });
});

describe("backup & activity", () => {
  it("restores account_permissions after both parents", () => {
    const i = RESTORE_TABLES.indexOf("account_permissions");
    expect(i).toBeGreaterThan(RESTORE_TABLES.indexOf("accounts"));
    expect(i).toBeGreaterThan(RESTORE_TABLES.indexOf("app_users"));
  });
  it("labels user actions", () => {
    for (const a of ["user.create", "user.update", "user.delete", "permission.update"])
      expect(activityLabel(a)).not.toBe(a);
  });
});
