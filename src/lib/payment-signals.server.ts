/**
 * v26 bank notifications forwarded by MacroDroid + invoice unique codes (issue #96). Pure parsing,
 * regex safety, matching and splitting live in ./bank-notify.ts; this module talks to the DB.
 *
 * Trust model
 * - The device token (`MACRODROID_TOKEN`, v16 integration secret) is compared as SHA-256 digests
 *   with timingSafeEqual BEFORE any rate limit or DB access; no token configured = 503 (fail closed).
 *   Only requests with a wrong token are rate limited per IP, so a spoofed X-Forwarded-For can never
 *   block the real phone; a valid device is limited per token hash.
 * - A notification is only a hint. Default: a single exact match (remaining + unique code) marks the
 *   invoice "Menunggu verifikasi" and the admin confirms it. Auto-confirm is opt-in
 *   (`MACRODROID_AUTO_CONFIRM`) because any app on the phone can post a look-alike notification.
 * - Booking is claimed atomically (`claimed_at` set where `payment_id is null and claimed_at is
 *   null`), so a retry, a second request or a double click can never book twice; a crash between
 *   booking and linking is recovered through the payment reference `signal:<id8>`.
 * - Stored text is minimised (`minimiseText`: one ≤300-char line, long digit runs masked); the raw
 *   body is never stored. Re-sent notifications are deduplicated by a SHA-256 `hash` (unique).
 */
import { createHash, timingSafeEqual } from "crypto";
import { db } from "./db.server";
import {
  NOTIFY_LIMITS,
  OPEN_SIGNAL_STATUSES,
  MAX_FORMATS,
  cleanLine,
  confirmProblem,
  formatProblems,
  formatValues,
  isFresh,
  isUniqueCode,
  matchSignal,
  minimiseText,
  normalizeNotification,
  parseNotification,
  pickUniqueCode,
  postedAt,
  signalReference,
  splitSignalAmount,
  type MatchCandidate,
  type NotifyFormat,
  type SignalStatus,
} from "./bank-notify";
import { NOTIFY_RATE_RULES } from "./rate-limit";
import { INVOICE_CATEGORY, remainingOf } from "./invoices";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const V26_MISSING =
  "Notifikasi bank belum aktif: jalankan bagian v26 di supabase/schema.sql.";
/** Max request body of the notify endpoint. */
export const NOTIFY_MAX_BODY = 16_000;
/** A claim older than this without a payment is considered abandoned (crash) and may be retried. */
const STALE_CLAIM_MS = 10 * 60_000;

const fin = () => import("./finance.server");
const signals = () => (db() as any).from("payment_signals");
const formatsTable = () => (db() as any).from("payment_notify_formats");
const isDup = (e: { message?: string; code?: string } | null | undefined) =>
  /duplicate key|23505/i.test(`${e?.message ?? ""} ${e?.code ?? ""}`);

async function missing(err: { message?: string; code?: string } | null | undefined) {
  return (await fin()).isMissingTable(err);
}

async function logErr(where: string, e: unknown) {
  try {
    (await import("./monitoring.server")).logError(where, e);
  } catch {
    /* never fail on logging */
  }
}

/** v26 present? A one-row select, not `head: true` (a HEAD on a missing table reports no error). */
export async function signalsReady(): Promise<boolean> {
  try {
    const res = await signals().select("id").limit(1);
    return !res.error;
  } catch {
    return false;
  }
}

/* ---------------- config ---------------- */

export type NotifyConfig = { token: string; autoConfirm: boolean; generic: boolean };

/** Effective MacroDroid config, or null without a (valid-length) device token. Never throws. */
export async function notifyConfig(): Promise<NotifyConfig | null> {
  try {
    const { getIntegrations } = await import("./integrations.server");
    const v = await getIntegrations([
      "MACRODROID_TOKEN",
      "MACRODROID_AUTO_CONFIRM",
      "MACRODROID_GENERIC",
    ]);
    const token = v.MACRODROID_TOKEN?.trim();
    if (!token || token.length < 32) return null;
    return {
      token,
      autoConfirm: v.MACRODROID_AUTO_CONFIRM?.toLowerCase() === "true",
      generic: v.MACRODROID_GENERIC?.toLowerCase() === "true",
    };
  } catch {
    return null;
  }
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time token check on SHA-256 digests (equal length, no early exit). */
export function tokenMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** `Authorization: Bearer <token>` or `X-Device-Token: <token>`. */
export function tokenFrom(headers: Headers): string {
  return (
    headers.get("x-device-token")?.trim() ??
    headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ??
    ""
  );
}

/* ---------------- unique codes ---------------- */

/**
 * The invoice's unique code, assigned on first use (open invoice, v26 present, MacroDroid token
 * configured). Returns null when any of those is missing. Never throws.
 */
export async function ensureUniqueCode(invoiceId: string): Promise<number | null> {
  try {
    if (!(await notifyConfig())) return null;
    const cur = await db()
      .from("invoices")
      .select("id, status, unique_code" as any)
      .eq("id", invoiceId)
      .maybeSingle();
    if (cur.error || !cur.data) return null;
    const row = cur.data as any;
    if (row.status !== "unpaid" && row.status !== "partial") return null;
    if (isUniqueCode(row.unique_code)) return row.unique_code;
    // Free codes held by invoices that are no longer open (best-effort sweep).
    await (db() as any)
      .from("invoices")
      .update({ unique_code: null })
      .not("unique_code", "is", null)
      .not("status", "in", "(unpaid,partial)");
    for (let attempt = 0; attempt < 5; attempt++) {
      const used = await (db() as any)
        .from("invoices")
        .select("unique_code")
        .not("unique_code", "is", null)
        .limit(1000);
      if (used.error) return null;
      const code = pickUniqueCode(((used.data ?? []) as any[]).map((r) => r.unique_code));
      if (code === null) return null;
      const upd = await (db() as any)
        .from("invoices")
        .update({ unique_code: code })
        .eq("id", invoiceId)
        .is("unique_code", null)
        .select("unique_code")
        .maybeSingle();
      if (!upd.error) {
        if (upd.data) return code;
        // Someone else assigned one meanwhile: read it back.
        const again = await (db() as any)
          .from("invoices")
          .select("unique_code")
          .eq("id", invoiceId)
          .maybeSingle();
        return isUniqueCode(again.data?.unique_code) ? again.data.unique_code : null;
      }
      if (!isDup(upd.error)) return null; // missing column (pre-v26) or other error
    }
    return null;
  } catch {
    return null;
  }
}

/** Clears the unique code of an invoice that is no longer open (paid/cancelled/draft). Never throws. */
export async function releaseUniqueCode(inv: { id: string; status: string }) {
  if (inv.status === "unpaid" || inv.status === "partial") return;
  try {
    await (db() as any)
      .from("invoices")
      .update({ unique_code: null })
      .eq("id", inv.id)
      .not("unique_code", "is", null);
  } catch {
    /* pre-v26 or transient: the next assignment sweeps it */
  }
}

/* ---------------- formats (admin) ---------------- */

export async function listFormats() {
  const res = await formatsTable().select("*").order("position").order("created_at");
  if (res.error) {
    if (await missing(res.error)) return { ready: false as const, formats: [] };
    throw new Error(res.error.message);
  }
  return { ready: true as const, formats: (res.data ?? []) as (NotifyFormat & { id: string })[] };
}

export async function saveFormat(id: string | null, f: NotifyFormat) {
  const problems = formatProblems(f);
  if (problems.length) throw new Error(problems[0]);
  const values = formatValues(f);
  if (id) {
    const res = await formatsTable()
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (res.error) {
      if (await missing(res.error)) throw new Error(V26_MISSING);
      throw new Error(res.error.message);
    }
    if (!res.data) throw new Error("Format tidak ditemukan");
    await (
      await fin()
    ).logActivity("payment_notify_formats.update", "payment_notify_formats", {
      name: values.name,
    });
    return res.data;
  }
  const count = await formatsTable().select("id");
  if (count.error) {
    if (await missing(count.error)) throw new Error(V26_MISSING);
    throw new Error(count.error.message);
  }
  const n = (count.data ?? []).length;
  if (n >= MAX_FORMATS) throw new Error("Terlalu banyak format (maks. 50)");
  const res = await formatsTable()
    .insert({ ...values, position: n })
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  await (
    await fin()
  ).logActivity("payment_notify_formats.create", "payment_notify_formats", {
    name: values.name,
  });
  return res.data;
}

export async function deleteFormat(id: string) {
  const res = await formatsTable().delete().eq("id", id).select("name");
  if (res.error) {
    if (await missing(res.error)) throw new Error(V26_MISSING);
    throw new Error(res.error.message);
  }
  if (res.data?.length)
    await (
      await fin()
    ).logActivity("payment_notify_formats.delete", "payment_notify_formats", {
      name: res.data[0].name,
    });
  return { ok: true };
}

/* ---------------- endpoint ---------------- */

export type NotifyOutcome = { status: number; body: Record<string, unknown> };

/** Hash for dedupe: the notification content + its own timestamp (or a 10-minute bucket). */
export function signalHash(
  n: { package: string; app: string; title: string; text: string },
  posted: number | null,
  receivedMs: number,
): string {
  const when = posted ?? Math.floor(receivedMs / 600_000);
  return createHash("sha256")
    .update(JSON.stringify([n.package || n.app, n.title, n.text, posted ? "t" : "b", when]))
    .digest("hex");
}

async function openCandidates(): Promise<MatchCandidate[] | null> {
  const { fetchAll } = await import("./paginate");
  const res = await fetchAll((from, to) =>
    (db() as any)
      .from("invoices")
      .select("id, total, paid, unique_code, created_at, account_id")
      .in("status", ["unpaid", "partial"])
      .order("id")
      .range(from, to),
  );
  if (res.error) return null;
  return (res.data ?? []) as MatchCandidate[];
}

/**
 * Processes one MacroDroid request AFTER the token check (route) and the device rate limit.
 * Never throws; answers 200 for stored/duplicate/ignored notifications so MacroDroid does not
 * retry, 400 for bodies without text, 503 for transient failures.
 */
export async function ingestNotification(
  body: unknown,
  c: NotifyConfig,
  now = Date.now(),
): Promise<NotifyOutcome> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  const raw = body as Record<string, unknown>;
  const n = normalizeNotification(raw);
  if (!n.title && !n.text) return { status: 400, body: { ok: false, error: "empty" } };
  const posted = postedAt(raw["posted_at"] ?? raw["timestamp"]);
  const hash = signalHash(n, posted, now);
  const base = {
    source: "macrodroid",
    hash,
    device: cleanLine(raw["device"], NOTIFY_LIMITS.device) || null,
    app: (n.app || n.package).slice(0, NOTIFY_LIMITS.app) || null,
    excerpt: minimiseText(n) || null,
    posted_at: new Date(posted ?? now).toISOString(),
  };

  try {
    const dup = await signals().select("id, status").eq("hash", hash).maybeSingle();
    if (dup.error) {
      if (await missing(dup.error)) return { status: 503, body: { ok: false } };
      throw new Error(dup.error.message);
    }
    if (dup.data)
      return { status: 200, body: { ok: true, duplicate: true, status: dup.data.status } };

    let row: Record<string, unknown>;
    let invoiceId: string | null = null;
    if (posted !== null && !isFresh(posted, now)) {
      row = { ...base, status: "ignored", reason: "Waktu notifikasi di luar jendela 48 jam" };
    } else {
      const formats = await listFormats();
      const parsed = parseNotification(formats.ready ? formats.formats : [], n, {
        generic: c.generic,
      });
      if (parsed.kind !== "amount") {
        row = {
          ...base,
          status: "ignored",
          reason: parsed.reason,
          format_name: parsed.kind === "ignored" ? (parsed.format?.name ?? null) : null,
        };
      } else {
        const cands = await openCandidates();
        if (!cands) return { status: 503, body: { ok: false } };
        const m = matchSignal(parsed.amount, cands, {
          postedAt: posted ?? now,
          accountId: parsed.format.account_id ?? null,
        });
        invoiceId = m.status === "matched" ? m.invoiceId : null;
        row = {
          ...base,
          amount: parsed.amount,
          format_name: parsed.format.name.slice(0, NOTIFY_LIMITS.name),
          status: m.status,
          invoice_id: invoiceId,
          candidate_ids: m.status === "ambiguous" ? m.invoiceIds.slice(0, 20) : [],
          reason: m.status === "unmatched" ? "Tidak ada invoice dengan nominal ini" : null,
        };
      }
    }

    const ins = await signals().insert(row).select("*").single();
    if (ins.error) {
      if (isDup(ins.error)) return { status: 200, body: { ok: true, duplicate: true } };
      if (await missing(ins.error)) return { status: 503, body: { ok: false } };
      throw new Error(ins.error.message);
    }
    if (Math.random() < 0.02) void pruneSignals();
    await (
      await fin()
    ).logActivity("payment_signals.create", "payment_signals", {
      amount: row["amount"] ?? null,
      currency: "IDR",
      status: row["status"],
    });

    let status = String(row["status"]);
    if (status === "matched" && c.autoConfirm && invoiceId) {
      try {
        const s = await import("./invoices.server");
        const inv = await s.loadInvoice(invoiceId);
        if (inv) {
          const split = splitSignalAmount(
            Number(row["amount"]),
            remainingOf(inv.total, inv.paid),
            (inv as any).unique_code,
          );
          const r = await confirmSignal(ins.data, inv, split.pay, split.extra, null, "auto");
          if (r.booked) status = "confirmed";
        }
      } catch (e) {
        // Stays "matched" (Menunggu verifikasi) with last_error; the admin confirms by hand.
        await signals()
          .update({ last_error: (e instanceof Error ? e.message : "error").slice(0, 300) })
          .eq("id", ins.data.id)
          .is("payment_id", null);
        await logErr("notify:auto-confirm", e);
      }
    }
    return { status: 200, body: { ok: true, status } };
  } catch (e) {
    await logErr("notify:ingest", e);
    return { status: 503, body: { ok: false } };
  }
}

/** Deletes old ignored/unmatched signals (> 90 days). Never throws. */
async function pruneSignals() {
  try {
    await signals()
      .delete()
      .in("status", ["ignored", "unmatched"])
      .lt("received_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
  } catch {
    /* best effort */
  }
}

/** Route entry: token (constant time) → bad-token IP limit → device limit → body → ingest. */
export async function handleNotify(
  headers: Headers,
  readBody: () => Promise<{ ok: true; value: unknown } | { ok: false; status: number }>,
  ip: string,
): Promise<NotifyOutcome> {
  const c = await notifyConfig();
  if (!c) return { status: 503, body: { ok: false } };
  const { rateHit, subjectHash } = await import("./rate-limit.server");
  if (!tokenMatches(tokenFrom(headers), c.token)) {
    const allowed = await rateHit(NOTIFY_RATE_RULES.bad, subjectHash(`ip:${ip}`));
    return { status: allowed ? 401 : 429, body: { ok: false } };
  }
  if (!(await signalsReady())) return { status: 503, body: { ok: false } };
  const device = subjectHash(`device:${digest(c.token).toString("hex")}`);
  if (!(await rateHit(NOTIFY_RATE_RULES.device, device)))
    return { status: 429, body: { ok: false } };
  const body = await readBody();
  if (!body.ok) return { status: body.status, body: { ok: false } };
  return ingestNotification(body.value, c);
}

/* ---------------- confirm / ignore ---------------- */

type InvoiceRow = import("./invoices.server").InvoiceRow;
export type SignalRow = {
  id: string;
  status: SignalStatus;
  amount: number | null;
  invoice_id: string | null;
  payment_id: string | null;
  claimed_at: string | null;
  posted_at: string | null;
  app: string | null;
  format_name: string | null;
};

export async function loadSignal(id: string): Promise<SignalRow | null> {
  const res = await signals().select("*").eq("id", id).maybeSingle();
  if (res.error) {
    if (await missing(res.error)) throw new Error(V26_MISSING);
    throw new Error(res.error.message);
  }
  return res.data
    ? { ...res.data, amount: res.data.amount == null ? null : Number(res.data.amount) }
    : null;
}

/**
 * Books a signal for `inv` exactly once: `pay` as an invoice payment (bookPayment, income
 * "Invoice"), `extra` (the unique code part) as its own small income on the same wallet, then a
 * best-effort payment confirmation email. Claim protocol as in gateway/payments.server.ts.
 */
export async function confirmSignal(
  signal: SignalRow,
  inv: InvoiceRow,
  pay: number,
  extra: number,
  paidAt: string | null,
  by: "auto" | "admin",
): Promise<{ booked: boolean; invoice: InvoiceRow }> {
  const problem = confirmProblem(signal, inv, pay);
  if (problem) throw new Error(problem);
  const now = Date.now();
  if (signal.claimed_at && now - Date.parse(signal.claimed_at) > STALE_CLAIM_MS)
    await signals()
      .update({ claimed_at: null })
      .eq("id", signal.id)
      .eq("claimed_at", signal.claimed_at)
      .is("payment_id", null);
  const mine = new Date(now).toISOString();
  const claim = await signals()
    .update({ claimed_at: mine, last_error: null })
    .eq("id", signal.id)
    .is("payment_id", null)
    .is("claimed_at", null)
    .in("status", [...OPEN_SIGNAL_STATUSES])
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) throw new Error("Notifikasi ini sedang atau sudah diproses");

  const release = (patch: Record<string, unknown> = {}) =>
    signals()
      .update({ claimed_at: null, ...patch })
      .eq("id", signal.id)
      .eq("claimed_at", mine)
      .is("payment_id", null);

  const s = await import("./invoices.server");
  const ref = signalReference(signal.id);
  let paymentId: string | null = null;
  let invoice = inv;
  let booked = false;
  try {
    // Crash recovery: a payment already booked under this signal's reference is linked, not re-booked.
    const prior = await db()
      .from("invoice_payments")
      .select("id")
      .eq("invoice_id", inv.id)
      .eq("reference", ref)
      .limit(1);
    if (prior.error) throw new Error(prior.error.message);
    paymentId = prior.data?.[0]?.id ?? null;
    if (!paymentId) {
      const res = await s.bookPayment(inv, {
        amount: pay,
        paid_at: paidAt,
        method: "transfer",
        reference: ref,
        note: `Notifikasi bank${signal.app ? ` (${signal.app})` : ""}${by === "auto" ? " · otomatis" : ""}`.slice(
          0,
          500,
        ),
      });
      paymentId = res.paymentId;
      invoice = res.invoice;
      booked = true;
    }
  } catch (e) {
    await release({ last_error: (e instanceof Error ? e.message : "error").slice(0, 300) });
    throw e;
  }
  await signals()
    .update({
      status: "confirmed",
      payment_id: paymentId,
      invoice_id: inv.id,
      reviewed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", signal.id)
    .is("payment_id", null);

  const f = await fin();
  if (booked && extra > 0 && inv.account_id) {
    try {
      await f.createFromExternal(
        {
          kind: "income",
          amount: extra,
          currency: "IDR",
          category: INVOICE_CATEGORY,
          account: null,
          to_account: null,
          description: `Kode unik invoice ${inv.number}`,
          merchant: null,
          date: paidAt ?? f.today(),
          source: "web",
          items: null,
          notes: `Ref: ${ref}`,
          external_id: `invoice_code:${signal.id}`,
          receipt_path: null,
          pocket: null,
        },
        { account_id: inv.account_id },
      );
    } catch (e) {
      await logErr("notify:unique-code-income", e);
    }
  }
  if (booked) {
    await f.logActivity("payment_signals.confirm", "payment_signals", {
      name: `${inv.number} · ${inv.customer_name}`,
      amount: pay + extra,
      currency: "IDR",
      by,
    });
    await (await import("./invoice-email.server")).sendPaymentConfirmation(invoice, pay);
  }
  return { booked, invoice };
}

export async function ignoreSignal(id: string, reason: string | null) {
  const res = await signals()
    .update({
      status: "ignored",
      reason: (reason ?? "Diabaikan admin").slice(0, 300),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("payment_id", null)
    .is("claimed_at", null)
    .in("status", [...OPEN_SIGNAL_STATUSES])
    .select("id")
    .maybeSingle();
  if (res.error) {
    if (await missing(res.error)) throw new Error(V26_MISSING);
    throw new Error(res.error.message);
  }
  if (!res.data) throw new Error("Notifikasi ini sudah diproses");
  await (await fin()).logActivity("payment_signals.ignore", "payment_signals", {});
  return { ok: true };
}

/* ---------------- admin queue ---------------- */

export type SignalFilter = "open" | "confirmed" | "ignored" | "all";

/** Matched signals per invoice id (drives "Menunggu verifikasi"; empty before v26/on error). */
export async function matchedSignalCounts(ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  try {
    const res = await signals()
      .select("invoice_id")
      .eq("status", "matched")
      .in("invoice_id", [...ids]);
    if (res.error) return out;
    for (const r of (res.data ?? []) as { invoice_id: string | null }[])
      if (r.invoice_id) out.set(r.invoice_id, (out.get(r.invoice_id) ?? 0) + 1);
  } catch {
    /* ignore */
  }
  return out;
}

/** Paginated signals plus the open invoices the admin can pick when confirming. */
export async function listSignals(o: { filter: SignalFilter; offset: number; limit: number }) {
  let q: any = signals().select(
    "id, device, app, excerpt, format_name, amount, posted_at, received_at, status, reason, invoice_id, candidate_ids, payment_id, last_error, claimed_at",
    { count: "exact" },
  );
  if (o.filter === "open") q = q.in("status", [...OPEN_SIGNAL_STATUSES]);
  else if (o.filter !== "all") q = q.eq("status", o.filter);
  q = q.order("received_at", { ascending: false }).range(o.offset, o.offset + o.limit - 1);
  const [list, open] = await Promise.all([
    q,
    signals().select("id").in("status", ["matched", "ambiguous", "unmatched"]).limit(1000),
  ]);
  if (list.error || open.error) {
    if ((await missing(list.error)) || (await missing(open.error)))
      return { ready: false as const };
    throw new Error((list.error ?? open.error)!.message);
  }
  const inv = await db()
    .from("invoices")
    .select("id, number, customer_name, status, total, paid, unique_code" as any)
    .in("status", ["unpaid", "partial"])
    .order("issue_date", { ascending: false })
    .limit(200);
  const openInvoices = ((inv.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    customer_name: r.customer_name as string,
    remaining: remainingOf(r.total, r.paid),
    unique_code: isUniqueCode(r.unique_code) ? (r.unique_code as number) : null,
  }));
  const linked = [
    ...new Set(
      ((list.data ?? []) as any[]).map((s) => s.invoice_id).filter((x: string | null) => !!x),
    ),
  ] as string[];
  const known = new Map(openInvoices.map((i) => [i.id, i]));
  const missingIds = linked.filter((id) => !known.has(id));
  if (missingIds.length) {
    const more = await db()
      .from("invoices")
      .select("id, number, customer_name, total, paid")
      .in("id", missingIds);
    for (const r of (more.data ?? []) as any[])
      known.set(r.id, {
        id: r.id,
        number: r.number,
        customer_name: r.customer_name,
        remaining: remainingOf(r.total, r.paid),
        unique_code: null,
      });
  }
  const items = ((list.data ?? []) as any[]).map((s) => ({
    ...s,
    amount: s.amount == null ? null : Number(s.amount),
    candidate_ids: (s.candidate_ids ?? []) as string[],
    invoice: s.invoice_id ? (known.get(s.invoice_id) ?? null) : null,
  }));
  return {
    ready: true as const,
    items,
    total: list.count ?? items.length,
    open: (open.data ?? []).length,
    invoices: openInvoices,
  };
}
