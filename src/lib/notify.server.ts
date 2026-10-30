/**
 * Per-member Telegram notifications (issue #75, optional schema v22 `notify_recipients` +
 * `notify_recipient_wallets`). Builds the `[{chat_id, text}]` list for the n8n
 * `/api/public/n8n/notifications` endpoint and backs the admin card in Settings → Pengguna.
 * Pure rules (chat id validation, recipient plan, wallet scope) live in notify.ts.
 *
 * - Owner: TELEGRAM_ADMIN_CHAT_ID (Settings → Integrasi > env) receives the exact text of the
 *   existing `/report` / `/reminders` endpoints (all wallets).
 * - Members: scope = wallets they may view (account_permissions), narrowed by their checklist.
 * - Missing v22 tables → owner only (never throws for that), so the endpoint works before v22.
 */
import { db } from "./db.server";
import { isMissingTable, logActivity } from "./finance.server";
import { grantsFromRows, type Level } from "./permissions";
import {
  planRecipients,
  withWalletLine,
  type NotifyKind,
  type NotifyMember,
  type NotifyRecipientInput,
  type NotifyTarget,
} from "./notify";
import { clampMessage } from "./bot";

const MISSING_V22 =
  "Notifikasi per anggota belum aktif — jalankan bagian v22 di supabase/schema.sql.";

type RecipientRow = {
  user_id: string;
  chat_id: string;
  enabled: boolean;
  send_report: boolean;
  send_reminders: boolean;
  updated_at?: string | null;
};

export type NotifySettings = {
  user_id: string;
  chat_id: string;
  enabled: boolean;
  send_report: boolean;
  send_reminders: boolean;
  wallets: string[];
};

/** Stored recipient rows + wallet subsets; `ready: false` when v22 is not run yet. */
export async function listNotifySettings(): Promise<{ ready: boolean; items: NotifySettings[] }> {
  const rec = await db()
    .from("notify_recipients")
    .select("user_id, chat_id, enabled, send_report, send_reminders");
  if (rec.error) {
    if (isMissingTable(rec.error)) return { ready: false, items: [] };
    throw new Error(rec.error.message);
  }
  const wal = await db().from("notify_recipient_wallets").select("user_id, account_id");
  if (wal.error) {
    if (isMissingTable(wal.error)) return { ready: false, items: [] };
    throw new Error(wal.error.message);
  }
  const byUser = new Map<string, string[]>();
  for (const w of wal.data ?? []) {
    const list = byUser.get(w.user_id) ?? [];
    list.push(w.account_id);
    byUser.set(w.user_id, list);
  }
  return {
    ready: true,
    items: ((rec.data ?? []) as RecipientRow[]).map((r) => ({
      user_id: r.user_id,
      chat_id: r.chat_id,
      enabled: r.enabled,
      send_report: r.send_report,
      send_reminders: r.send_reminders,
      wallets: (byUser.get(r.user_id) ?? []).sort(),
    })),
  };
}

/** Loads a member row (never the owner) for the admin card. */
async function memberOf(userId: string) {
  const owner = (process.env["APP_USERNAME"] ?? "").toLowerCase();
  const res = await db()
    .from("app_users")
    .select("id, username, role")
    .eq("id", userId)
    .maybeSingle();
  if (res.error) {
    if (isMissingTable(res.error)) throw new Error(MISSING_V22);
    throw new Error(res.error.message);
  }
  const row = res.data;
  if (!row) throw new Error("Pengguna tidak ditemukan");
  if (row.role !== "member" || row.username.toLowerCase() === owner)
    throw new Error("Pemilik memakai TELEGRAM_ADMIN_CHAT_ID di Pengaturan → Integrasi");
  return row;
}

/**
 * Saves one member's notification settings (admin only). The wallet checklist may only contain
 * wallets the member can view right now; anything else is refused (no silent widening).
 */
export async function saveNotifySettings(input: NotifyRecipientInput) {
  const row = await memberOf(input.user_id);
  const perms = await db()
    .from("account_permissions")
    .select("account_id, level")
    .eq("user_id", row.id);
  if (perms.error) {
    if (isMissingTable(perms.error)) throw new Error(MISSING_V22);
    throw new Error(perms.error.message);
  }
  const grants = grantsFromRows(perms.data);
  const wallets = [...new Set(input.wallets)].sort();
  if (wallets.some((id) => !grants[id])) throw new Error("Dompet di luar akses anggota");
  const up = await db().from("notify_recipients").upsert(
    {
      user_id: row.id,
      chat_id: input.chat_id,
      enabled: input.enabled,
      send_report: input.send_report,
      send_reminders: input.send_reminders,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (up.error) {
    if (isMissingTable(up.error)) throw new Error(MISSING_V22);
    throw new Error(up.error.message);
  }
  const del = await db().from("notify_recipient_wallets").delete().eq("user_id", row.id);
  if (del.error) {
    if (isMissingTable(del.error)) throw new Error(MISSING_V22);
    throw new Error(del.error.message);
  }
  if (wallets.length) {
    const ins = await db()
      .from("notify_recipient_wallets")
      .insert(wallets.map((account_id) => ({ user_id: row.id, account_id })));
    if (ins.error) throw new Error(ins.error.message);
  }
  await logActivity("notify.update", "notify_recipients", { name: row.username });
  return { ok: true };
}

/** Removes a member's notification settings (wallet subset cascades). */
export async function deleteNotifySettings(userId: string) {
  const row = await memberOf(userId);
  const del = await db().from("notify_recipients").delete().eq("user_id", row.id);
  if (del.error) {
    if (isMissingTable(del.error)) return { ok: true };
    throw new Error(del.error.message);
  }
  await logActivity("notify.delete", "notify_recipients", { name: row.username });
  return { ok: true };
}

/** Members with notification rows + their current grants; [] before v22 (or v18). */
async function notifyMembers(): Promise<NotifyMember[]> {
  let settings: NotifySettings[];
  try {
    const s = await listNotifySettings();
    if (!s.ready || !s.items.length) return [];
    settings = s.items;
  } catch (e) {
    // The owner message must still go out when the optional member part fails.
    const { logError } = await import("./monitoring.server");
    logError("notify:members", e);
    return [];
  }
  const ids = settings.map((s) => s.user_id);
  const [users, perms] = await Promise.all([
    db().from("app_users").select("id, username, display_name, role, is_active").in("id", ids),
    db().from("account_permissions").select("user_id, account_id, level").in("user_id", ids),
  ]);
  if (users.error || perms.error) {
    const { logError } = await import("./monitoring.server");
    logError("notify:members", new Error((users.error ?? perms.error)!.message));
    return [];
  }
  const owner = (process.env["APP_USERNAME"] ?? "").toLowerCase();
  const out: NotifyMember[] = [];
  for (const s of settings) {
    const u = (users.data ?? []).find((x) => x.id === s.user_id);
    if (!u || u.username.toLowerCase() === owner) continue;
    const grants: Record<string, Level> = grantsFromRows(
      (perms.data ?? []).filter((p) => p.user_id === s.user_id),
    );
    out.push({
      user_id: s.user_id,
      username: u.username,
      display_name: u.display_name ?? null,
      role: u.role,
      is_active: u.is_active,
      chat_id: s.chat_id,
      enabled: s.enabled,
      send_report: s.send_report,
      send_reminders: s.send_reminders,
      wallets: s.wallets,
      grants,
    });
  }
  return out;
}

export type NotifyMessage = {
  chat_id: string;
  text: string;
  /** "owner" or the member username (for n8n logs; not shown in Telegram). */
  recipient: string;
  /** Number of wallets in scope; null = all wallets (owner). */
  wallets: number | null;
  /** Reminders only: items in this recipient's list. */
  count?: number;
};

async function walletNames(ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return [];
  const res = await db()
    .from("accounts")
    .select("id, name")
    .in("id", [...ids]);
  if (res.error) return [];
  return (res.data ?? []).map((a) => a.name).sort((a, b) => a.localeCompare(b));
}

/**
 * Messages for one scheduled notification. `adminChatId` empty → members only. Reminders with
 * `skipEmpty` drop recipients with nothing due (the n8n "Ada tagihan?" check per recipient).
 */
export async function buildNotifications(opts: {
  kind: NotifyKind;
  period: string;
  days: number;
  skipEmpty: boolean;
}): Promise<{ ok: true; messages: NotifyMessage[] } | { ok: false; error: string }> {
  const { getIntegration } = await import("./integrations.server");
  const adminChatId = await getIntegration("TELEGRAM_ADMIN_CHAT_ID");
  const members = await notifyMembers();
  const plan: NotifyTarget[] = planRecipients({ adminChatId, kind: opts.kind, members });
  const messages: NotifyMessage[] = [];
  if (opts.kind === "report") {
    const { reportData, reportText } = await import("./bot.server");
    // Validates the period and runs the lazy fees/recurring once for every recipient.
    if (!(await reportData(opts.period))) return { ok: false, error: "Periode tidak dikenali" };
    for (const r of plan) {
      let text = await reportText(opts.period, { scope: r.scope, skipLazy: true });
      if (r.scope) text = withWalletLine(text, await walletNames(r.scope));
      messages.push(msg(r, text));
    }
    return { ok: true, messages };
  }
  const { computeReminders, remindersText } = await import("./finance.server");
  let lazyDone = false;
  for (const r of plan) {
    const list = await computeReminders(opts.days, { skipFees: lazyDone, scope: r.scope });
    lazyDone = true;
    if (opts.skipEmpty && !list.length) continue;
    let text = remindersText(list);
    if (r.scope) text = withWalletLine(text, await walletNames(r.scope));
    messages.push({ ...msg(r, text), count: list.length });
  }
  return { ok: true, messages };
}

function msg(r: NotifyTarget, text: string): NotifyMessage {
  return {
    chat_id: r.chat_id,
    text: clampMessage(text, 4000),
    recipient: r.username ?? "owner",
    wallets: r.scope ? r.scope.length : null,
  };
}
