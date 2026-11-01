/**
 * Server-side client IP (issue #118): reads env-only TRUSTED_PROXY (a security setting, never
 * from the DB) and the connection address the runtime puts on `request.ip`.
 */
import { clientIp, ipRateKey, parseTrustedProxy, type TrustedProxy } from "./client-ip";
import { logError } from "./monitoring.server";

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

let unknownLogged = false;

/**
 * Per-IP rate-limit key (`ipRateKey`, IPv6 by /64) or null when the runtime gave no usable
 * address. Callers skip the per-IP rule on null (never one shared "unknown" bucket) and keep
 * their other limits; the first miss per process is logged so operators notice.
 */
export function ipRateSubject(ip: string): string | null {
  const key = ipRateKey(ip);
  if (key === null && !unknownLogged) {
    unknownLogged = true;
    logError(
      "client-ip:unknown",
      new Error("No client address (request.ip); per-IP rate limits skipped"),
    );
  }
  return key;
}

/** Test hook: re-arm the one-time "unknown address" log. */
export function resetIpRateSubjectLog(): void {
  unknownLogged = false;
}
