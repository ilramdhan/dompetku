import { z } from "zod";

/** Vercel menolak body > 4,5 MB; tolak lebih awal dengan 413 yang jelas. */
export const MAX_BOT_BODY_BYTES = 4_500_000;
export const BOT_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

// "image/jpg" bukan MIME resmi tapi sering dikirim klien; samakan ke image/jpeg.
const mimeType = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .trim()
          .toLowerCase()
          .replace(/^image\/jpg$/, "image/jpeg")
      : v,
  z.enum(BOT_IMAGE_MIME),
);

// Optional bot username for group mentions (#71); "@name" is accepted and stripped.
const botUsername = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().replace(/^@/, "") : v),
  z.string().regex(/^[A-Za-z0-9_]{3,64}$/),
);

// Body: { update_id, chat_id, text?, image_base64?, mime_type?, callback_data?,
//         chat_type?, reply_to_bot?, bot_username? } — no chat_type = private (old templates).
export const botUpdateSchema = z
  .object({
    update_id: z.coerce.number().int().nonnegative(),
    chat_id: z.coerce.string().regex(/^-?\d{1,20}$/),
    text: z.string().max(2000).nullable().optional(),
    image_base64: z.string().min(100).max(4_400_000).nullable().optional(),
    mime_type: mimeType.nullable().optional(),
    callback_data: z.string().max(64).nullable().optional(),
    chat_type: z.enum(["private", "group", "supergroup", "channel"]).nullable().optional(),
    reply_to_bot: z.boolean().nullable().optional(),
    bot_username: botUsername.nullable().optional(),
  })
  .refine((v) => v.text || v.image_base64 || v.callback_data, {
    message: "text, image_base64, atau callback_data wajib diisi",
  })
  .refine((v) => !v.image_base64 || !!v.mime_type, {
    message: "mime_type wajib diisi bila image_base64 dikirim",
    path: ["mime_type"],
  });

export type BodyResult =
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

const tooLarge = (): BodyResult => ({
  ok: false,
  status: 413,
  error: `Body terlalu besar (maks ${(MAX_BOT_BODY_BYTES / 1_000_000).toFixed(1)} MB)`,
});

/**
 * Reads a JSON body without ever buffering more than `max` bytes: a declared Content-Length above
 * the cap is refused up front, and a body without one is streamed with a running size check.
 */
export async function readJsonBody(
  request: Request,
  max = MAX_BOT_BODY_BYTES,
): Promise<BodyResult> {
  const declared = request.headers.get("content-length");
  if (declared != null && declared.trim() !== "") {
    const n = Number(declared);
    if (Number.isFinite(n) && n > max) return tooLarge();
  }
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Body bukan JSON yang valid" };
  }
}
