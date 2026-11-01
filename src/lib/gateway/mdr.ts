/**
 * Pure Midtrans MDR (merchant discount rate) helpers (issue #124). Midtrans' Get Status API and
 * notifications carry no fee / net amount field (fees appear only in the dashboard payout report
 * and the BI-SNAP reporting API), so the fee is computed from an admin-configured schedule
 * (`MIDTRANS_FEES`, Settings → Integrasi) per `payment_type`. Unit-tested in src/test/gateway-mdr.test.ts.
 *
 * Format: `qris=0.7%; gopay=2%; credit_card=2.9%+2000; bank_transfer=4000; *=0`
 * - key = Midtrans `payment_type` (lower-case letters, digits, `_`) or `*` for every other type;
 * - value = percent (`0.7%`), flat rupiah (`4000`) or both (`2.9%+2000`), VAT included by the admin.
 * Empty schedule = no MDR booked (default, unchanged behaviour).
 *
 * The fee is booked once per gateway row as an expense in category "Biaya Admin" with
 * `external_id = invoice_mdr:<row id>`; refunds never book, reverse or repeat it.
 */

export type MdrRule = { percent: number; flat: number };
export type MdrRules = Record<string, MdrRule>;

const KEY = /^(\*|[a-z0-9_]{2,40})$/;
const VALUE = /^(?:(\d{1,2}(?:\.\d{1,3})?)%)?(?:\s*\+?\s*(\d{1,7}))?$/;

/** Parsed schedule, or an Indonesian i18n error key for the first bad entry. */
export function parseMdrRules(
  raw: string | null | undefined,
): { ok: true; rules: MdrRules } | { ok: false; error: string } {
  const rules: MdrRules = {};
  const parts = (raw ?? "")
    .split(/[;\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 40) return { ok: false, error: "Terlalu banyak aturan biaya" };
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 1) return { ok: false, error: "Format biaya: metode=persen%+tetap" };
    const key = p.slice(0, i).trim().toLowerCase();
    const val = p
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, "");
    const m = VALUE.exec(val);
    if (!KEY.test(key) || !val || !m || (m[1] === undefined && m[2] === undefined))
      return { ok: false, error: "Format biaya: metode=persen%+tetap" };
    const percent = m[1] === undefined ? 0 : Number(m[1]);
    if (percent >= 50) return { ok: false, error: "Persentase biaya harus di bawah 50%" };
    // "2.9%2000" without a plus is ambiguous: require "+" between percent and flat.
    if (m[1] !== undefined && m[2] !== undefined && !val.includes("+"))
      return { ok: false, error: "Format biaya: metode=persen%+tetap" };
    rules[key] = { percent, flat: m[2] === undefined ? 0 : Number(m[2]) };
  }
  return { ok: true, rules };
}

/** Canonical text of a valid schedule ("QRIS = 0.7 %" → "qris=0.7%"); input unchanged if invalid. */
export function formatMdrRules(raw: string): string {
  const r = parseMdrRules(raw);
  if (!r.ok) return raw;
  return Object.entries(r.rules)
    .map(([k, v]) =>
      v.percent && v.flat
        ? `${k}=${v.percent}%+${v.flat}`
        : v.percent
          ? `${k}=${v.percent}%`
          : `${k}=${v.flat}`,
    )
    .join("; ");
}

/** Integration validator: null when valid. */
export function mdrRulesProblem(raw: string): string | null {
  const r = parseMdrRules(raw);
  return r.ok ? null : r.error;
}

/**
 * MDR in whole rupiah for one paid order: percent × gross + flat, rounded half up, never negative
 * and always below the gross amount (a broken schedule never books more than the payment).
 * 0 = nothing to book (no schedule, no matching rule or zero rate).
 */
export function mdrFee(
  rules: MdrRules | null | undefined,
  paymentType: string | null | undefined,
  gross: number | string,
): number {
  if (!rules) return 0;
  const g = Number(gross);
  if (!(g > 0)) return 0;
  const type = (paymentType ?? "").toLowerCase();
  const rule = (type && rules[type]) || rules["*"];
  if (!rule) return 0;
  const fee = Math.round((g * rule.percent) / 100 + rule.flat);
  if (!(fee > 0)) return 0;
  return fee < g ? fee : 0;
}

/** Idempotency key of the MDR expense of one gateway row (one fee per order, ever). */
export const mdrExternalId = (rowId: string) =>
  `invoice_mdr:${String(rowId)
    .replace(/[^A-Za-z0-9._~-]/g, "")
    .slice(0, 80)}`;
