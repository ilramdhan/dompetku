/**
 * Zod input schema for the settings form, kept apart from the pure helpers in app-settings.ts so
 * public pages (landing, login) that only need branding defaults do not pull zod into their bundle.
 */
import { z } from "zod";
import { CURRENCIES } from "./currencies";
import { isHttpsUrl, isLogoDataUrl, isValidTimezone } from "./app-settings";

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable(),
  );

/** Input accepted by the settings form (null/empty = back to default). */
export const appSettingsInputSchema = z.object({
  app_name: optText(40),
  tagline: optText(80),
  logo_data: z
    .string()
    .nullable()
    .refine((v) => v === null || isLogoDataUrl(v), "Logo harus PNG/JPEG/WebP maksimal 200 KB"),
  timezone: optText(64).refine((v) => v === null || isValidTimezone(v), "Zona waktu tidak valid"),
  base_currency: z.enum(CURRENCIES),
  landing_enabled: z.boolean(),
  landing_tagline: optText(160),
  github_url: optText(200).refine((v) => v === null || isHttpsUrl(v), "URL harus https://"),
  bot_default_account_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  reminder_days: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(1).max(365).nullable(),
  ),
});
export type AppSettingsInput = z.output<typeof appSettingsInputSchema>;
