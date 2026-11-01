/**
 * Server-side client IP (issue #118): reads env-only TRUSTED_PROXY (a security setting, never
 * from the DB) and the connection address the runtime puts on `request.ip`.
 */
import { clientIp, parseTrustedProxy, type TrustedProxy } from "./client-ip";

let cached: { raw: string; trust: TrustedProxy } | null = null;

export function trustedProxy(): TrustedProxy {
  const raw = process.env["TRUSTED_PROXY"] ?? "";
  if (cached?.raw !== raw) cached = { raw, trust: parseTrustedProxy(raw) };
  return cached.trust;
}

/** Client IP for per-IP rate limits; X-Forwarded-For counts only through TRUSTED_PROXY hops. */
export function requestIp(request: Request): string {
  return clientIp(request, trustedProxy());
}
