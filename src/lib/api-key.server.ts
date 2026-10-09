import { createHash, timingSafeEqual } from "crypto";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Validates `x-api-key` (or `Authorization: Bearer`) against N8N_API_KEY (Settings → Integrasi
 * value, else env). Returns a Response when denied; fails closed when no key ≥ 24 chars is set.
 */
export async function checkApiKey(request: Request): Promise<Response | null> {
  // Demo instances (DEMO_MODE=true) have no bot, backup or reminder-email automation.
  if (process.env["DEMO_MODE"] === "true") return json({ ok: false, error: "demo" }, 403);
  let expected: string | undefined;
  try {
    expected = await (await import("./integrations.server")).getIntegration("N8N_API_KEY");
  } catch {
    expected = undefined; // fail closed
  }
  if (!expected || expected.length < 24)
    return json({ ok: false, error: "N8N_API_KEY belum diatur di server" }, 503);
  const given =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return json({ ok: false, error: "Unauthorized" }, 401);
  return null;
}
