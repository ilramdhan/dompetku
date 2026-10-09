import { describe, expect, it } from "vitest";
import {
  formatPasswordHash,
  parsePasswordHash,
  passwordProblems,
  passwordStrength,
  SCRYPT_DEFAULTS,
  validScryptParams,
} from "@/lib/password";
import { hashPassword, verifyPassword } from "@/lib/password.server";

const SALT = "A".repeat(22);
const HASH = "B".repeat(43);

describe("password hash format", () => {
  it("round-trips format/parse", () => {
    const s = formatPasswordHash({ ...SCRYPT_DEFAULTS, salt: SALT, hash: HASH });
    expect(s).toBe(`scrypt$v1$32768$8$1$${SALT}$${HASH}`);
    expect(parsePasswordHash(s)).toEqual({ N: 32768, r: 8, p: 1, salt: SALT, hash: HASH });
  });

  it("rejects malformed or unsafe strings", () => {
    for (const bad of [
      null,
      "",
      "plain-password",
      `bcrypt$v1$32768$8$1$${SALT}$${HASH}`,
      `scrypt$v2$32768$8$1$${SALT}$${HASH}`,
      `scrypt$v1$30000$8$1$${SALT}$${HASH}`, // N not a power of two
      `scrypt$v1$1024$8$1$${SALT}$${HASH}`, // too weak
      `scrypt$v1$${2 ** 24}$8$1$${SALT}$${HASH}`, // DoS-sized
      `scrypt$v1$32768$8$1$short$${HASH}`,
      `scrypt$v1$32768$8$1$${SALT}$${HASH}$extra`,
      `scrypt$v1$32768$8$1$${SALT}$ab+/`,
    ])
      expect(parsePasswordHash(bad)).toBeNull();
  });

  it("bounds scrypt params", () => {
    expect(validScryptParams(SCRYPT_DEFAULTS)).toBe(true);
    expect(validScryptParams({ N: 2 ** 14, r: 8, p: 1 })).toBe(true);
    expect(validScryptParams({ N: 2 ** 20, r: 32, p: 1 })).toBe(false); // > 256 MB
    expect(validScryptParams({ N: 32768, r: 0, p: 1 })).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  const fast = { N: 2 ** 14, r: 8, p: 1 };
  it("verifies the right password only, with a random salt", async () => {
    const a = await hashPassword("correct horse battery", fast);
    const b = await hashPassword("correct horse battery", fast);
    expect(a).not.toBe(b);
    expect(parsePasswordHash(a)).not.toBeNull();
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword("correct horse battery", "garbage")).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblems("Tr0ub4dour&3x", { username: "me" })).toEqual([]);
  });
  it("flags short, username, repeated, common, whitespace and unchanged", () => {
    expect(passwordProblems("short")).toContain("Password minimal 10 karakter");
    expect(passwordProblems("AdminUser1", { username: "adminuser1" })).toContain(
      "Password tidak boleh sama dengan username",
    );
    expect(passwordProblems("aaaaaaaaaaaa")).toContain(
      "Password tidak boleh satu karakter berulang",
    );
    expect(passwordProblems("Password123")).toContain("Password terlalu umum");
    expect(passwordProblems(" spaced-password ")).toContain(
      "Password tidak boleh diawali/diakhiri spasi",
    );
    expect(passwordProblems("same-password-1", { current: "same-password-1" })).toContain(
      "Password baru harus berbeda dari password lama",
    );
    expect(passwordProblems("x".repeat(201))).toContain("Password maksimal 200 karakter");
  });
  it("scores strength", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").score).toBeLessThanOrEqual(1);
    expect(passwordStrength("Abcdefgh1!xyz-long").score).toBe(4);
    expect(passwordStrength("password123").score).toBe(0);
    expect(passwordStrength("abc").hints).toHaveLength(5);
  });
});
