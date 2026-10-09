import { db } from "./db.server";

const BUCKET = "receipts";

async function ensureBucket() {
  const { error } = await db().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

/** Simpan foto nota (data URL base64) ke Supabase Storage, kembalikan path-nya. */
export async function uploadReceipt(dataUrl: string, prefix = ""): Promise<{ path: string }> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Format gambar tidak didukung (JPEG/PNG/WebP).");
  const buf = Buffer.from(m[2]!, "base64");
  if (buf.length > 5_000_000) throw new Error("Gambar maksimal 5 MB.");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  // v18: members upload under `m/<user id>/` so they can only reference their own uploads.
  const path = `${prefix}${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await ensureBucket();
  const { error } = await db().storage.from(BUCKET).upload(path, buf, { contentType: m[1]! });
  if (error) throw new Error(error.message);
  return { path };
}

/** URL sementara (5 menit) untuk melihat foto nota. */
export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function removeReceipt(path: string | null | undefined) {
  if (!path) return;
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) console.error("remove receipt failed", error.message);
}
