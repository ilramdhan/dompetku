/**
 * Pure helpers for invoice emails (issue #95): masked recipient for the activity log, which
 * reminder stage an open invoice is in, and the de-duplication window per stage. No schema:
 * the "already sent" marker is the `invoices.email` row in activity_log (see
 * invoice-email.server.ts). Unit-tested in src/test/invoice-email.test.ts.
 */
import { diffDays } from "./dates";
import type { InvoiceEmailKind } from "./email";

export const EMAIL_KIND_LABEL: Record<InvoiceEmailKind, string> = {
  invoice: "Invoice",
  payment: "Konfirmasi pembayaran",
  reminder_due: "Pengingat jatuh tempo",
  overdue: "Pengingat terlambat",
};

/** `ilham@gmail.com` → `i***m@gmail.com` (log/UI never store the full address). */
export function maskEmail(email: string | null | undefined): string {
  const s = String(email ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return "***";
  const local = s.slice(0, at);
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}***${tail}${s.slice(at)}`;
}

/** Plausible single recipient (the DB stores a validated email; this is the last-line check). */
export function isEmailAddress(v: unknown): v is string {
  return (
    typeof v === "string" && v.length <= 200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v)
  );
}

/** Days before the due date in which `reminder_due` starts (default lead time). */
export const DEFAULT_LEAD_DAYS = 3;
export const MAX_LEAD_DAYS = 30;

export function leadDays(v: unknown, fallback = DEFAULT_LEAD_DAYS): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= MAX_LEAD_DAYS ? n : fallback;
}

/**
 * Stage of an invoice for reminders: `overdue` when due before `today`, `reminder_due` when due
 * within `lead` days (inclusive), else null. Only open (unpaid/partial) invoices with a due date.
 */
export function reminderStage(
  inv: { status: string; due_date: string | null; remaining: number },
  today: string,
  lead = DEFAULT_LEAD_DAYS,
): "reminder_due" | "overdue" | null {
  if (inv.status !== "unpaid" && inv.status !== "partial") return null;
  if (!inv.due_date || !(inv.remaining > 0.005)) return null;
  const d = diffDays(today, inv.due_date.slice(0, 10));
  if (d < 0) return "overdue";
  return d <= lead ? "reminder_due" : null;
}

/**
 * Min days between two reminder mails of the same stage for one invoice: the due-soon mail is
 * sent once per invoice, the overdue one again at most weekly.
 */
export function dedupeWindowDays(kind: "reminder_due" | "overdue"): number {
  return kind === "overdue" ? 7 : MAX_LEAD_DAYS + 1;
}
