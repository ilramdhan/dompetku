/**
 * Server-only AES-256-GCM encryption for secrets stored in `integration_settings` (v16).
 * Format: `v1:<iv>:<tag>:<ciphertext>` (base64url, random 12-byte IV per value) — see
 * parseCipher/formatCipher in integrations.ts. Key: SETTINGS_ENCRYPTION_KEY (≥ 32 chars) if set,
 * else HKDF-SHA256 over SESSION_SECRET with a domain-separation label, so the cookie-signing key
 * is never used directly. Rotating either one makes stored secrets undecryptable (→ env fallback).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { formatCipher, parseCipher } from "./integrations";

const INFO = "dompetku:integration-settings:v1";
const SALT = "dompetku-settings";

/** 32-byte key, or null when neither env var is usable. */
export function settingsKey(
  env: { SETTINGS_ENCRYPTION_KEY?: string | undefined; SESSION_SECRET?: string | undefined } = {
    SETTINGS_ENCRYPTION_KEY: process.env["SETTINGS_ENCRYPTION_KEY"],
    SESSION_SECRET: process.env["SESSION_SECRET"],
  },
): Buffer | null {
  const own = env.SETTINGS_ENCRYPTION_KEY;
  const base = own && own.length >= 32 ? own : env.SESSION_SECRET;
  if (!base || base.length < 32) return null;
  const label = own && own.length >= 32 ? `${INFO}:own` : `${INFO}:session`;
  return Buffer.from(hkdfSync("sha256", base, SALT, label, 32));
}

/** `aad` (the setting's name) is authenticated, so a ciphertext can't be moved to another key. */
export function encryptSecret(
  plain: string,
  aad: string,
  key: Buffer | null = settingsKey(),
): string {
  if (!key) throw new Error("SESSION_SECRET (≥ 32 karakter) dibutuhkan untuk menyimpan rahasia.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return formatCipher({
    iv: iv.toString("base64url"),
    tag: c.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  });
}

/** Plaintext, or null when the value is malformed, tampered with, or the key changed. Never throws. */
export function decryptSecret(
  stored: string,
  aad: string,
  key: Buffer | null = settingsKey(),
): string | null {
  const p = parseCipher(stored);
  if (!p || !key) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(p.iv, "base64url"));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(Buffer.from(p.tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(p.data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
