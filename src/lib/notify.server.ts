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
  maskChatId,
  notifySetByMap,
  planRecipients,
  planSelfNotify,
  sameSelfNotify,
  viewableWallets,
  withWalletLine,
  type MyNotifyInput,
  type NotifyKind,
  type NotifyMember,
  type NotifyRecipientInput,
  type NotifySetBy,
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
  /**
   * Who saved the row last (activity log, #122 L1): "member" = chat id set by the member and NOT
   * verified (the admin dialog flags it); null = unknown (no activity log / older rows).
   */
  set_by?: NotifySetBy | null;
};

/** Last saver per member from `activity_log` (best effort: {} when missing or failing). */
async function notifySetBy(userIds: readonly string[]): Promise<Record<string, NotifySetBy>> {
  if (!userIds.length) return {};
  try {
    const [log, users] = await Promise.all([
      db()
        .from("activity_log")
        .select("action, detail")
        .in("action", ["notify.update", "notify.self_update"])
        .order("created_at", { ascending: false })
        .limit(500),
      db()
        .from("app_users")
        .select("id, username")
        .in("id", [...userIds]),
    ]);
    if (log.error || users.error) return {};
    return notifySetByMap(
      log.data ?? [],
      (users.data ?? []).map((u) => ({ user_id: u.id, username: u.username })),
    );
  } catch {
    return {};
  }
}

/** Stored recipient rows + wallet subsets; `ready: false` when v22 is not run yet. */
export async function listNotifySettings(
  opts: { setBy?: boolean } = {},
): Promise<{ ready: boolean; items: NotifySettings[] }> {
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
  const rows = (rec.data ?? []) as RecipientRow[];
  const setBy = opts.setBy ? await notifySetBy(rows.map((r) => r.user_id)) : {};
  return {
    ready: true,
    items: rows.map((r) => ({
      user_id: r.user_id,
      chat_id: r.chat_id,
      enabled: r.enabled,
      send_report: r.send_report,
      send_reminders: r.send_reminders,
      wallets: (byUser.get(r.user_id) ?? []).sort(),
      set_by: setBy[r.user_id] ?? null,
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
  await setNotifyWallets(row.id, wallets);
  await logActivity("notify.update", "notify_recipients", {
    name: row.username,
    user_id: row.id,
    chat: maskChatId(input.chat_id),
  });
  return { ok: true };
}

/* Fail-closed checklist rewrite (#122 L2) ------------------------------------------------- */

const WALLETS_FAILED =
  "Gagal menyimpan daftar dompet — notifikasi dinonaktifkan sampai admin mengaktifkannya lagi.";

/**
 * Replaces a recipient's wallet checklist so it can never silently become EMPTY (= every viewable
 * wallet) when the member asked for a subset: new rows are inserted first (existing ones kept),
 * only then the rows outside the set are removed, and the result is re-read. Any failure, or an
 * empty result for a non-empty request (e.g. two interleaved saves), disables the row
 * (`enabled = false`; deleted when even that fails) and throws — no notifications rather than
 * all wallets. An empty request means "all viewable wallets" on purpose.
 */
async function setNotifyWallets(userId: string, wallets: readonly string[]) {
  const table = () => db().from("notify_recipient_wallets");
  const step = (r: { error: { message: string; code?: string } | null }) => {
    if (!r.error) return;
    if (isMissingTable(r.error)) throw new MissingV22();
    throw new Error(r.error.message);
  };
  try {
    if (wallets.length) {
      step(
        await table().upsert(
          wallets.map((account_id) => ({ user_id: userId, account_id })),
          { onConflict: "user_id,account_id", ignoreDuplicates: true },
        ),
      );
      step(
        await table()
          .delete()
          .eq("user_id", userId)
          .not("account_id", "in", `(${wallets.join(",")})`),
      );
      const now = await table().select("account_id").eq("user_id", userId);
      step(now);
      if (!now.data?.length) throw new Error("empty checklist after save");
    } else {
      step(await table().delete().eq("user_id", userId));
    }
  } catch (e) {
    if (e instanceof MissingV22) throw new Error(MISSING_V22);
    await failClosed(userId, e);
    throw new Error(WALLETS_FAILED);
  }
}

class MissingV22 extends Error {}

async function failClosed(userId: string, cause: unknown) {
  const { logError } = await import("./monitoring.server");
  logError("notify:wallets", cause);
  const off = await db()
    .from("notify_recipients")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (off.error) await db().from("notify_recipients").delete().eq("user_id", userId);
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

/* ---------------- Profile → Notifikasi Telegram (#122): a member's OWN row ---------------- */

export type MyNotify = {
  ready: boolean;
  chat_id: string;
  /** false = muted by the admin (members cannot unmute themselves). */
  enabled: boolean;
  send_report: boolean;
  send_reminders: boolean;
  wallets: string[];
  /** Wallets the member may view right now (checklist options). */
  options: { id: string; name: string }[];
};

/** Fresh wallet grants of a member (never the cached session, never client input). */
async function freshGrants(userId: string): Promise<Record<string, Level> | null> {
  const perms = await db()
    .from("account_permissions")
    .select("account_id, level")
    .eq("user_id", userId);
  if (perms.error) {
    if (isMissingTable(perms.error)) return null;
    throw new Error(perms.error.message);
  }
  return grantsFromRows(perms.data);
}

/** The signed-in member's own notification settings; `ready: false` before v22. */
export async function getMyNotify(userId: string): Promise<MyNotify> {
  const empty: MyNotify = {
    ready: false,
    chat_id: "",
    enabled: true,
    send_report: true,
    send_reminders: true,
    wallets: [],
    options: [],
  };
  const grants = await freshGrants(userId);
  if (!grants) return empty;
  const rec = await db()
    .from("notify_recipients")
    .select("user_id, chat_id, enabled, send_report, send_reminders")
    .eq("user_id", userId)
    .maybeSingle();
  if (rec.error) {
    if (isMissingTable(rec.error)) return empty;
    throw new Error(rec.error.message);
  }
  const wal = await db()
    .from("notify_recipient_wallets")
    .select("user_id, account_id")
    .eq("user_id", userId);
  if (wal.error) {
    if (isMissingTable(wal.error)) return empty;
    throw new Error(wal.error.message);
  }
  const view = viewableWallets(grants);
  const names = view.length
    ? await db().from("accounts").select("id, name").in("id", view)
    : { data: [], error: null };
  if (names.error) throw new Error(names.error.message);
  const row = rec.data as RecipientRow | null;
  return {
    ready: true,
    chat_id: row?.chat_id ?? "",
    enabled: row?.enabled ?? true,
    send_report: row?.send_report ?? true,
    send_reminders: row?.send_reminders ?? true,
    // Only show checked wallets the member can still view (revoked access wins).
    wallets: (wal.data ?? [])
      .map((w) => w.account_id)
      .filter((id) => view.includes(id))
      .sort(),
    options: (names.data ?? [])
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Saves the signed-in member's own chat id, toggles and wallet checklist. The user id comes from
 * the session, the checklist must stay inside their fresh grants, `enabled` (admin mute) is never
 * changed here, and an empty chat id removes the row (stop receiving). These chat ids are never
 * added to BOT_ALLOWED_CHAT_IDS: receiving notifications does not grant bot access.
 */
export async function saveMyNotify(userId: string, input: MyNotifyInput) {
  const row = await memberOf(userId);
  const grants = await freshGrants(row.id);
  if (!grants) throw new Error(MISSING_V22);
  const cur = await db()
    .from("notify_recipients")
    .select("user_id, chat_id, enabled, send_report, send_reminders")
    .eq("user_id", row.id)
    .maybeSingle();
  if (cur.error) {
    if (isMissingTable(cur.error)) throw new Error(MISSING_V22);
    throw new Error(cur.error.message);
  }
  const curRow = cur.data as RecipientRow | null;
  const plan = planSelfNotify(input, grants, { muted: curRow?.enabled === false });
  if (plan.action === "error") throw new Error(plan.error);
  if (plan.action === "keep") return { ok: true };
  if (plan.action === "delete") {
    // `.select()` returns the removed rows: log only when a row actually existed (#122 L3).
    const del = await db()
      .from("notify_recipients")
      .delete()
      .eq("user_id", row.id)
      .select("user_id");
    if (del.error) {
      if (isMissingTable(del.error)) throw new Error(MISSING_V22);
      throw new Error(del.error.message);
    }
    if (del.data?.length)
      await logActivity("notify.self_delete", "notify_recipients", {
        name: row.username,
        user_id: row.id,
      });
    return { ok: true };
  }
  if (curRow) {
    // Unchanged save → no writes, no activity row (#122 L3: repeated saves cannot spam the log).
    const wal = await db()
      .from("notify_recipient_wallets")
      .select("account_id")
      .eq("user_id", row.id);
    if (wal.error) throw new Error(wal.error.message);
    const stored = { ...curRow, wallets: (wal.data ?? []).map((w) => w.account_id) };
    if (sameSelfNotify(stored, { ...input, wallets: plan.wallets })) return { ok: true };
  }
  const up = await db().from("notify_recipients").upsert(
    {
      user_id: row.id,
      chat_id: input.chat_id,
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
  await setNotifyWallets(row.id, plan.wallets);
  // Masked chat id so the admin can see what the member pointed notifications at (#122 L1).
  await logActivity("notify.self_update", "notify_recipients", {
    name: row.username,
    user_id: row.id,
    chat: maskChatId(input.chat_id),
  });
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
