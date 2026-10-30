/**
 * Invoice emails (issue #95) over the existing Resend setup (RESEND_API_KEY/EMAIL_FROM via
 * getIntegrations; no new env, no schema). Pure builder: buildInvoiceEmail() in email.ts; pure
 * stage/dedupe/mask helpers: invoice-email.ts.
 *
 * - Manual "Kirim invoice": only issued invoices; preconditions (Resend configured, customer email)
 *   are checked BEFORE the public link is created/rotated, so a refused send never kills a link.
 *   Only the token hash is stored, so an existing link cannot be recovered: sending with a link
 *   rotates it (the UI asks for confirmation first). If Resend fails after rotating, the new link
 *   is returned so the admin can still copy it.
 * - Payment confirmation: best-effort, no link (never rotates), never throws.
 * - Reminders (due soon / overdue): customers without a recoverable link get the mail without one
 *   (payment instructions as text). De-duplicated through activity_log rows `invoices.email`
 *   (due soon once per invoice, overdue at most weekly).
 * - Every send is logged as `invoices.email` with the kind and a partially masked recipient.
 */
import { db } from "./db.server";
import { addDays } from "./dates";
import { buildInvoiceEmail, type InvoiceEmailKind } from "./email";
import {
  DEFAULT_LEAD_DAYS,
  EMAIL_KIND_LABEL,
  dedupeWindowDays,
  isEmailAddress,
  leadDays,
  maskEmail,
  reminderStage,
} from "./invoice-email";
import { shareUrl, isPublicStatus } from "./invoice-share";
import type { InvoiceRow } from "./invoices.server";

const fin = () => import("./finance.server");

export const ERR = {
  demo: "Tidak tersedia di mode demo",
  noResend: "Email belum dikonfigurasi (RESEND_API_KEY dan EMAIL_FROM).",
  noEmail: "Pelanggan belum punya alamat email.",
  notIssued: "Terbitkan invoice dulu; draft dan invoice batal tidak bisa dikirim",
  failed: "Gagal mengirim email.",
} as const;

export type SendResult = { sent: true } | { sent: false; reason: string };

/** Resend over fetch; never throws. */
async function deliver(
  to: string,
  mail: { subject: string; text: string; html: string },
): Promise<SendResult> {
  try {
    const { getIntegrations } = await import("./integrations.server");
    const cfg = await getIntegrations(["RESEND_API_KEY", "EMAIL_FROM"]);
    if (!cfg.RESEND_API_KEY || !cfg.EMAIL_FROM) return { sent: false, reason: ERR.noResend };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.EMAIL_FROM,
        to: [to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      (await import("./monitoring.server")).logError(
        "invoice:email",
        new Error(`Resend ${res.status}`),
      );
      return { sent: false, reason: ERR.failed };
    }
    return { sent: true };
  } catch (e) {
    try {
      (await import("./monitoring.server")).logError("invoice:email", e);
    } catch {
      /* never fail on logging */
    }
    return { sent: false, reason: ERR.failed };
  }
}

/** True when Resend credentials exist (cheap check done before touching links). */
async function resendReady(): Promise<boolean> {
  try {
    const { getIntegrations } = await import("./integrations.server");
    const cfg = await getIntegrations(["RESEND_API_KEY", "EMAIL_FROM"]);
    return !!cfg.RESEND_API_KEY && !!cfg.EMAIL_FROM;
  } catch {
    return false;
  }
}

async function brandName(): Promise<string> {
  try {
    return (await (await import("./app-settings.server")).getAppSettings()).app_name;
  } catch {
    return "Dompetku";
  }
}

async function logSend(
  inv: Pick<InvoiceRow, "id" | "number">,
  kind: InvoiceEmailKind,
  to: string,
  via: string,
) {
  await (
    await fin()
  ).logActivity("invoices.email", "invoices", {
    name: `${inv.number} · ${EMAIL_KIND_LABEL[kind]} → ${maskEmail(to)}`,
    invoice_id: inv.id,
    kind,
    via,
  });
}

type MailInv = Pick<
  InvoiceRow,
  | "id"
  | "number"
  | "customer_name"
  | "customer_email"
  | "due_date"
  | "total"
  | "paid"
  | "currency"
  | "status"
>;

async function compose(
  inv: MailInv,
  kind: InvoiceEmailKind,
  o: { link?: string | null; paymentAmount?: number | null; remaining?: number },
) {
  const [{ today }, ip, brand] = await Promise.all([
    fin(),
    import("./invoice-payments.server"),
    brandName(),
  ]);
  const methods = kind === "payment" ? [] : await ip.emailMethodsFor(inv.id);
  return buildInvoiceEmail({
    kind,
    brand,
    number: inv.number,
    customer_name: inv.customer_name,
    currency: inv.currency,
    due_date: inv.due_date,
    total: Number(inv.total),
    paid: Number(inv.paid),
    remaining: o.remaining ?? Math.max(0, Number(inv.total) - Number(inv.paid)),
    today: today(),
    link: o.link ?? null,
    methods,
    payment_amount: o.paymentAmount ?? null,
  });
}

/**
 * Manual send. Creates a public link when none is active or rotates it (`share` lets the caller
 * supply the origin and the expiry); returns the link so the UI can show it as well.
 */
export async function sendInvoiceLinkEmail(
  inv: InvoiceRow,
  opts: { origin: string; expiresDays: number | null },
): Promise<{ sent: boolean; reason?: string; link?: string; to?: string }> {
  const demo = await import("./demo.server");
  demo.assertNotDemo();
  if (!isPublicStatus(inv.status)) throw new Error(ERR.notIssued);
  if (!isEmailAddress(inv.customer_email)) throw new Error(ERR.noEmail);
  if (!(await resendReady())) throw new Error(ERR.noResend);
  const share = await import("./invoice-share.server");
  const made = await share.createShare(inv, opts.expiresDays, false);
  const link = shareUrl(opts.origin, made.token);
  const mail = await compose(inv, "invoice", { link });
  const r = await deliver(inv.customer_email, mail);
  if (!r.sent) return { sent: false, reason: r.reason, link };
  await logSend(inv, "invoice", inv.customer_email, "web");
  return { sent: true, link, to: maskEmail(inv.customer_email) };
}

/**
 * Payment confirmation (best effort, no link so nothing is rotated). `inv` is the invoice AFTER
 * the payment. Never throws and does nothing in demo, without Resend or without customer email.
 */
export async function sendPaymentConfirmation(inv: InvoiceRow, amount: number): Promise<void> {
  try {
    if ((await import("./demo.server")).isDemo()) return;
    if (!isEmailAddress(inv.customer_email)) return;
    if (!(await resendReady())) return;
    const mail = await compose(inv, "payment", {
      paymentAmount: amount,
      remaining: Math.max(0, Number(inv.total) - Number(inv.paid)),
    });
    const r = await deliver(inv.customer_email, mail);
    if (r.sent) await logSend(inv, "payment", inv.customer_email, "web");
  } catch (e) {
    try {
      (await import("./monitoring.server")).logError("invoice:email-payment", e);
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- due soon / overdue reminders ---------------- */

export type DueMail = {
  invoice_id: string;
  number: string;
  to: string;
  kind: "reminder_due" | "overdue";
  due_date: string;
  remaining: number;
  subject: string;
  text: string;
  html: string;
};

type Skipped = { number: string; reason: string };

/**
 * Open invoices that need a reminder now and have not got one inside the stage's window. Reads
 * only; `{ ready:false }` before v21, and no mails at all when the activity log cannot be read
 * (otherwise nothing could be de-duplicated).
 */
export async function pendingDueMails(
  leadInput?: unknown,
): Promise<{ ready: boolean; lead: number; mails: DueMail[]; skipped: Skipped[] }> {
  const lead = leadDays(leadInput, DEFAULT_LEAD_DAYS);
  const f = await fin();
  const today = f.today();
  const res = await db()
    .from("invoices")
    .select("*")
    .in("status", ["unpaid", "partial"])
    .not("due_date", "is", null)
    .lte("due_date", addDays(today, lead))
    .order("due_date")
    .limit(500);
  if (res.error) {
    if (f.isMissingTable(res.error)) return { ready: false, lead, mails: [], skipped: [] };
    throw new Error(res.error.message);
  }
  const since = new Date(Date.now() - (dedupeWindowDays("reminder_due") + 1) * 86_400_000);
  const log = await db()
    .from("activity_log")
    .select("detail, created_at")
    .eq("action", "invoices.email")
    .gte("created_at", since.toISOString())
    .limit(5000);
  if (log.error) throw new Error(log.error.message);
  const last = new Map<string, number>();
  for (const r of log.data ?? []) {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    if (d["kind"] !== "reminder_due" && d["kind"] !== "overdue") continue;
    const k = `${d["invoice_id"]}:${d["kind"]}`;
    last.set(k, Math.max(last.get(k) ?? 0, Date.parse(r.created_at as string) || 0));
  }
  const mails: DueMail[] = [];
  const skipped: Skipped[] = [];
  // v25: invoices on refund hold (customer was just refunded) get no reminders until re-billed.
  const held = await (
    await import("./gateway/payments.server")
  ).refundHeldInvoices(((res.data ?? []) as { id: string }[]).map((r) => r.id));
  for (const row of (res.data ?? []) as unknown as InvoiceRow[]) {
    if (held.has(row.id)) {
      skipped.push({ number: row.number, reason: "refunded" });
      continue;
    }
    const inv = { ...row, total: Number(row.total), paid: Number(row.paid) };
    const remaining = Math.max(0, inv.total - inv.paid);
    const kind = reminderStage({ ...inv, remaining }, today, lead);
    if (!kind) continue;
    if (!isEmailAddress(inv.customer_email)) {
      skipped.push({ number: inv.number, reason: "no_email" });
      continue;
    }
    const prev = last.get(`${inv.id}:${kind}`);
    if (prev && Date.now() - prev < dedupeWindowDays(kind) * 86_400_000) {
      skipped.push({ number: inv.number, reason: "already_sent" });
      continue;
    }
    const mail = await compose(inv, kind, { remaining });
    mails.push({
      invoice_id: inv.id,
      number: inv.number,
      to: inv.customer_email,
      kind,
      due_date: String(inv.due_date).slice(0, 10),
      remaining,
      ...mail,
    });
  }
  return { ready: true, lead, mails, skipped };
}

/**
 * Sends (`resend`) or hands over (`payload`) the pending reminders; both log `invoices.email`
 * so the next run skips them. Resend failures are not logged, so they retry next run.
 */
export async function runDueMails(
  mode: "resend" | "payload",
  leadInput?: unknown,
): Promise<{
  ready: boolean;
  mode: string;
  count: number;
  sent: number;
  failed: number;
  mails?: DueMail[];
  skipped: Skipped[];
  reason?: string;
}> {
  const demo = await import("./demo.server");
  demo.assertNotDemo();
  const p = await pendingDueMails(leadInput);
  const base = { ready: p.ready, mode, count: p.mails.length, skipped: p.skipped };
  if (mode === "payload") {
    for (const m of p.mails)
      await logSend({ id: m.invoice_id, number: m.number }, m.kind, m.to, "n8n");
    return { ...base, sent: 0, failed: 0, mails: p.mails };
  }
  if (p.mails.length && !(await resendReady()))
    return { ...base, sent: 0, failed: p.mails.length, reason: ERR.noResend };
  let sent = 0;
  let failed = 0;
  for (const m of p.mails) {
    const r = await deliver(m.to, m);
    if (r.sent) {
      sent++;
      await logSend({ id: m.invoice_id, number: m.number }, m.kind, m.to, "n8n");
    } else failed++;
  }
  return { ...base, sent, failed };
}
