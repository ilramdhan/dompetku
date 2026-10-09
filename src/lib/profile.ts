/**
 * Pure, client-safe profile helpers (v17 `app_users`), unit-tested. The avatar reuses the logo
 * rules from app-settings.ts: a PNG/JPEG/WebP base64 data URL ≤ 200 KB stored inline (no Storage,
 * no SVG), resized client-side to a small square before upload.
 */
import { z } from "zod";
import { isLogoDataUrl, MAX_LOGO_BYTES } from "./app-settings";
import { PASSWORD_MAX } from "./password";

export const MAX_AVATAR_BYTES = MAX_LOGO_BYTES;
/** Square edge in px the browser resizes avatars to. */
export const AVATAR_SIZE = 256;
export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const isAvatarDataUrl = isLogoDataUrl;

export type Profile = {
  username: string;
  display_name: string | null;
  address: string | null;
  avatar: string | null;
  role: Role;
  updated_at: string | null;
};

export type ProfileRow = {
  username: string;
  display_name: string | null;
  address: string | null;
  avatar: string | null;
  role: string | null;
  updated_at: string | null;
};

/** Profile for `username`: the DB row when present, else empty fields (env user). Owner is always admin. */
export function resolveProfile(
  username: string,
  row: Partial<ProfileRow> | null,
  isOwner: boolean,
): Profile {
  const r = row ?? {};
  const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
  return {
    username,
    display_name: clean(r.display_name),
    address: clean(r.address),
    avatar: isAvatarDataUrl(r.avatar) ? r.avatar : null,
    role: isOwner ? "admin" : r.role === "admin" ? "admin" : "member",
    updated_at: r.updated_at ?? null,
  };
}

/** Up to two initials from the display name (or username) for the avatar fallback. */
export function initials(name: string | null | undefined, username = ""): string {
  const src = (name?.trim() || username.trim() || "?").replace(/[_.-]+/g, " ");
  const words = src.split(/\s+/).filter(Boolean);
  const chars =
    words.length >= 2
      ? [words[0]!, words[words.length - 1]!].map((w) => Array.from(w)[0]!)
      : Array.from(words[0] ?? "?").slice(0, 2);
  return chars.join("").toUpperCase();
}

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable(),
  );

export const profileInputSchema = z.object({
  display_name: optText(80),
  address: optText(300),
  avatar: z
    .string()
    .nullable()
    .refine((v) => v === null || isAvatarDataUrl(v), "Foto harus PNG/JPEG/WebP maksimal 200 KB"),
});
export type ProfileInput = z.output<typeof profileInputSchema>;

/** Policy (length, username, …) is checked on the server with passwordProblems(). */
export const changePasswordSchema = z.object({
  current: z.string().min(1).max(PASSWORD_MAX),
  next: z
    .string()
    .min(1)
    .max(PASSWORD_MAX + 1),
});
