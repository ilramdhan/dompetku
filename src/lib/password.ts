/**
 * Pure, client-safe password helpers (unit-tested): the versioned scrypt hash string format and
 * the password policy / strength hints used by the Profile page. The hashing itself (node crypto
 * scrypt + constant-time compare) lives in password.server.ts.
 *
 * Hash format: `scrypt$v1$<N>$<r>$<p>$<salt base64url>$<hash base64url>`.
 */
export const HASH_SCHEME = "scrypt";
export const HASH_VERSION = "v1";
/** Defaults: N = 2^15, r = 8, p = 1 (~32 MB, tens of ms per hash). */
export const SCRYPT_DEFAULTS = { N: 32768, r: 8, p: 1 } as const;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

export const PASSWORD_MIN = 10;
/** Same upper bound as the login form validator. */
export const PASSWORD_MAX = 200;

export type ScryptParams = { N: number; r: number; p: number };
export type ParsedHash = ScryptParams & { salt: string; hash: string };

const B64URL = /^[A-Za-z0-9_-]+$/;
/** Characters of unpadded base64url needed for `n` bytes. */
const b64len = (n: number) => Math.ceil((n * 4) / 3);

const isPow2 = (n: number) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;

/** True when the scrypt cost parameters are within sane, DoS-safe bounds. */
export function validScryptParams({ N, r, p }: ScryptParams): boolean {
  return (
    isPow2(N) &&
    N >= 2 ** 14 &&
    N <= 2 ** 20 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 32 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 16 &&
    128 * N * r <= 256 * 1024 * 1024
  );
}

export function formatPasswordHash(p: ParsedHash): string {
  return [HASH_SCHEME, HASH_VERSION, p.N, p.r, p.p, p.salt, p.hash].join("$");
}

/** Parses a stored hash string; null for anything malformed or out of bounds. */
export function parsePasswordHash(s: unknown): ParsedHash | null {
  if (typeof s !== "string" || s.length > 300) return null;
  const parts = s.split("$");
  if (parts.length !== 7) return null;
  const [scheme, version, n, r, p, salt, hash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (scheme !== HASH_SCHEME || version !== HASH_VERSION) return null;
  if (![n, r, p].every((x) => /^\d{1,8}$/.test(x))) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!validScryptParams(params)) return null;
  if (!B64URL.test(salt) || salt.length < b64len(SALT_BYTES)) return null;
  if (!B64URL.test(hash) || hash.length < b64len(KEY_BYTES) || hash.length > b64len(64))
    return null;
  return { ...params, salt, hash };
}

/** Policy violations as i18n keys (Indonesian dictionary keys); empty = acceptable. */
export function passwordProblems(
  password: string,
  opts: { username?: string | null; current?: string | null } = {},
): string[] {
  const out: string[] = [];
  const pw = password ?? "";
  if (pw.length < PASSWORD_MIN) out.push("Password minimal 10 karakter");
  if (pw.length > PASSWORD_MAX) out.push("Password maksimal 200 karakter");
  if (pw.trim() !== pw) out.push("Password tidak boleh diawali/diakhiri spasi");
  const u = opts.username?.trim().toLowerCase();
  if (u && pw.toLowerCase() === u) out.push("Password tidak boleh sama dengan username");
  if (pw && /^(.)\1*$/.test(pw)) out.push("Password tidak boleh satu karakter berulang");
  if (opts.current != null && pw && pw === opts.current)
    out.push("Password baru harus berbeda dari password lama");
  if (COMMON.has(pw.toLowerCase())) out.push("Password terlalu umum");
  return out;
}

const COMMON = new Set([
  "1234567890",
  "12345678910",
  "0123456789",
  "qwertyuiop",
  "password123",
  "password1234",
  "passw0rd123",
  "iloveyou123",
  "admin12345",
  "administrator",
  "qwerty12345",
  "1q2w3e4r5t",
  "abcdefghij",
  "dompetku123",
]);

export type StrengthHint = { key: string; ok: boolean };

/** Strength score 0–4 plus checklist hints (i18n keys) for the password form. */
export function passwordStrength(password: string): { score: number; hints: StrengthHint[] } {
  const pw = password ?? "";
  const hints: StrengthHint[] = [
    { key: "Minimal 10 karakter", ok: pw.length >= PASSWORD_MIN },
    { key: "Huruf besar dan kecil", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { key: "Mengandung angka", ok: /\d/.test(pw) },
    { key: "Mengandung simbol", ok: /[^A-Za-z0-9]/.test(pw) },
    { key: "16 karakter atau lebih", ok: pw.length >= 16 },
  ];
  if (!pw) return { score: 0, hints };
  let score = hints.filter((h) => h.ok).length - 1;
  if (pw.length < PASSWORD_MIN) score = Math.min(score, 1);
  if (COMMON.has(pw.toLowerCase())) score = 0;
  return { score: Math.max(0, Math.min(4, score)), hints };
}
