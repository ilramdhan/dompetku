/**
 * Recurring transactions (schema v10, optional table). Auto-post items are recorded lazily when the
 * dashboard / reminders load (like applyMonthlyFees); manual items show up as reminders with a
 * "Catat" action. Every posted occurrence carries a notes marker + external_id so retries,
 * parallel requests and double taps never record it twice.
 */
import { db } from "./db.server";
import type { Tables } from "./database.types";
import {
  insertTransaction,
  isMissingTable,
  logActivity,
  today,
  type Reminder,
} from "./finance.server";
import { diffDays } from "./dates";
import { inNotifyScope } from "./notify";
import { dueOccurrences, recurringExternalId, recurringMarker, resumeNextDue } from "./recurring";

type RecurringRow = Tables<"recurring_transactions">;

const KIND_LABEL: Record<RecurringRow["kind"], string> = {
  income: "pemasukan",
  expense: "pengeluaran",
  transfer: "transfer",
};

function isDuplicate(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint|23505/i.test(m);
}

/** Insert one occurrence as a normal transaction (source "web": the enum has no "recurring"). */
async function postOccurrence(r: RecurringRow, dueDate: string, occurredAt: string) {
  try {
    return await insertTransaction(
      {
        kind: r.kind,
        amount: Number(r.amount),
        currency: r.currency,
        account_id: r.account_id,
        to_account_id: r.kind === "transfer" ? r.to_account_id : null,
        category_id: r.kind === "transfer" ? null : r.category_id,
        description: r.description || r.name,
        merchant: r.merchant,
        occurred_at: occurredAt,
        source: "web",
        items: null,
        notes: recurringMarker(r.id, dueDate),
        receipt_path: null,
      },
      null,
      { external_id: recurringExternalId(r.id, dueDate) },
    );
  } catch (e) {
    // A concurrent request already posted it (unique external_id index from v7).
    if (isDuplicate(e)) return null;
    throw e;
  }
}

/** Markers of the given occurrences that already exist as transactions. */
async function recordedMarkers(markers: string[]): Promise<Set<string>> {
  if (!markers.length) return new Set();
  const res = await db().from("transactions").select("notes").in("notes", markers);
  if (res.error) throw new Error(res.error.message);
  return new Set((res.data ?? []).map((r) => String(r.notes)));
}

/** Post due auto_post occurrences (≤12 missed per item), advance next_due, end expired items. */
export async function applyRecurring(): Promise<number> {
  try {
    const t = today();
    const res = await db()
      .from("recurring_transactions")
      .select("*")
      .eq("active", true)
      .eq("auto_post", true)
      .lte("next_due", t);
    if (res.error) {
      if (!isMissingTable(res.error)) console.error("recurring load failed", res.error.message);
      return 0;
    }
    const items = res.data ?? [];
    if (!items.length) return 0;
    const plans = items.map((r) => ({ r, due: dueOccurrences(r, t) }));
    const recorded = await recordedMarkers(
      plans.flatMap((p) => p.due.dates.map((d) => recurringMarker(p.r.id, d))),
    );
    let posted = 0;
    for (const { r, due } of plans) {
      for (const d of due.dates) {
        if (recorded.has(recurringMarker(r.id, d))) continue;
        if (await postOccurrence(r, d, d)) posted++;
      }
      const upd = await db()
        .from("recurring_transactions")
        .update({ next_due: due.next, ...(due.ended ? { active: false } : {}) })
        .eq("id", r.id);
      if (upd.error) console.error("recurring advance failed", upd.error.message);
    }
    return posted;
  } catch (e) {
    // Never break the dashboard / reminders because of an optional feature.
    console.error("applyRecurring failed", e);
    return 0;
  }
}

/** Manual (non auto_post) items due within the window, for computeReminders(). */
export async function recurringReminders(
  t: string,
  limit: string,
  rate: number,
  scope: readonly string[] | null = null,
): Promise<Reminder[]> {
  try {
    const res = await db()
      .from("recurring_transactions")
      .select("*")
      .eq("active", true)
      .eq("auto_post", false)
      .lte("next_due", limit);
    if (res.error) {
      if (!isMissingTable(res.error))
        console.error("recurring reminders failed", res.error.message);
      return [];
    }
    return (
      (res.data ?? [])
        .filter((r) => !r.end_date || r.next_due <= r.end_date)
        // v22 member notifications: only items on (or transferring to) a wallet in scope.
        .filter((r) => !scope || inNotifyScope(scope, r.account_id, r.to_account_id))
        .map((r) => {
          const amount = Number(r.amount);
          return {
            type: "recurring" as const,
            id: r.id,
            title: `Berulang: ${r.name} (${KIND_LABEL[r.kind]})`,
            amount,
            currency: r.currency,
            amount_idr: Math.round(amount * (r.currency === "USD" ? rate : 1) * 100) / 100,
            due_date: r.next_due,
            days_left: diffDays(t, r.next_due),
            overdue: r.next_due < t,
          };
        })
    );
  } catch (e) {
    console.error("recurring reminders failed", e);
    return [];
  }
}

/** "Catat sekarang": record the current occurrence (next_due) and advance the schedule. */
export async function postRecurringNow(id: string, date: string | null) {
  const res = await db().from("recurring_transactions").select("*").eq("id", id).single();
  if (res.error) throw new Error(res.error.message);
  const r = res.data;
  const due = r.next_due;
  const already = await recordedMarkers([recurringMarker(r.id, due)]);
  const tx = already.size ? null : await postOccurrence(r, due, date ?? today());
  const { next, ended } = dueOccurrences(r, due, 1);
  const upd = await db()
    .from("recurring_transactions")
    .update({ next_due: next, ...(ended ? { active: false } : {}) })
    .eq("id", id);
  if (upd.error) throw new Error(upd.error.message);
  await logActivity("recurring.post", "recurring_transactions", {
    name: r.name,
    amount: Number(r.amount),
    currency: r.currency,
  });
  return { ok: true, posted: !!tx, next_due: next, ended };
}

/** Pause / resume. Resuming skips occurrences missed while paused (no catch-up burst). */
export async function setRecurringActive(id: string, active: boolean) {
  const res = await db().from("recurring_transactions").select("*").eq("id", id).single();
  if (res.error) throw new Error(res.error.message);
  const r = res.data;
  const next_due = active ? resumeNextDue(r, today()) : r.next_due;
  if (active && r.end_date && next_due > r.end_date)
    throw new Error("Jadwal sudah melewati tanggal akhir");
  const upd = await db().from("recurring_transactions").update({ active, next_due }).eq("id", id);
  if (upd.error) throw new Error(upd.error.message);
  await logActivity(active ? "recurring.resume" : "recurring.pause", "recurring_transactions", {
    name: r.name,
  });
  return { ok: true, active, next_due };
}

/** Rows for the page; `ready: false` until the v10 schema section has been run. */
export async function listRecurring() {
  const res = await db()
    .from("recurring_transactions")
    .select("*")
    .order("active", { ascending: false })
    .order("next_due", { ascending: true });
  if (res.error) {
    if (isMissingTable(res.error)) return { ready: false, rows: [] as RecurringRow[] };
    throw new Error(res.error.message);
  }
  return { ready: true, rows: res.data ?? [] };
}
