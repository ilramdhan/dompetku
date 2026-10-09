/**
 * Zero-dependency server error monitoring.
 * - Always: one single-line JSON entry via console.error (readable/filterable in Vercel logs).
 * - Optional: when SENTRY_DSN is set, the event is POSTed to Sentry's envelope endpoint
 *   (fire-and-forget, 3 s timeout). Never throws.
 * No Telegram alerts: n8n relays Telegram traffic by default (direct mode is optional), so use the
 * n8n error workflow or Sentry alert rules for notifications.
 */
import { buildLogEvent, buildSentryEnvelope, formatLogLine, parseSentryDsn } from "./monitoring";

const SENTRY_TIMEOUT_MS = 3000;

export function logError(
  scope: string,
  err: unknown,
  extra: { request?: Request | undefined; path?: string | undefined } & Record<
    string,
    unknown
  > = {},
): void {
  try {
    const ev = buildLogEvent(scope, err, extra);
    // A string arg passes through error-capture's console.error wrapper unchanged.
    console.error(formatLogLine(ev));
    const dsn = parseSentryDsn(process.env["SENTRY_DSN"]);
    if (!dsn) return;
    const body = buildSentryEnvelope(ev, dsn, {
      environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "production",
      release: process.env["VERCEL_GIT_COMMIT_SHA"],
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SENTRY_TIMEOUT_MS);
    fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=dompetku/1.0`,
      },
      body,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  } catch {
    // Monitoring must never break the request.
  }
}
