/**
 * Server-only password hashing with node crypto scrypt (random 16-byte salt, versioned string
 * format from password.ts) and constant-time comparison.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import {
  formatPasswordHash,
  KEY_BYTES,
  parsePasswordHash,
  SALT_BYTES,
  SCRYPT_DEFAULTS,
  type ScryptParams,
} from "./password";

function scrypt(password: string, salt: Buffer, len: number, p: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(
      password.normalize("NFKC"),
      salt,
      len,
      { N: p.N, r: p.r, p: p.p, maxmem: 128 * p.N * p.r * 2 + 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_DEFAULTS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, params);
  return formatPasswordHash({
    ...params,
    salt: salt.toString("base64url"),
    hash: key.toString("base64url"),
  });
}

/** True when `password` matches the stored hash. A malformed hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.hash, "base64url");
  try {
    const key = await scrypt(
      password,
      Buffer.from(parsed.salt, "base64url"),
      expected.length,
      parsed,
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Constant-time string equality (hashes both sides so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
