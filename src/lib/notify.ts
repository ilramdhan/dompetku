/**
 * Pure, client-safe helpers for per-member Telegram notifications (issue #75, schema v22):
 * chat id validation, the recipient plan of the n8n `/api/public/n8n/notifications` endpoint and
 * the wallet scope of each member. Unit-tested in src/test/notify.test.ts; DB work lives in
 * notify.server.ts.
 *
 * Rules
 * - The owner receives the global (all wallets) message at TELEGRAM_ADMIN_CHAT_ID, exactly the
 *   text of the existing `/report` and `/reminders` endpoints.
 * - A member receives a message scoped to the wallets they may VIEW (account_permissions),
 *   optionally narrowed by a stored wallet subset; subset ids they can no longer view are ignored.
 *   No viewable wallet left = no message (never an unscoped fallback).
 * - Notification chat ids are NOT BOT_ALLOWED_CHAT_IDS: receiving reports never grants bot access.
 */
import { z } from "zod";
import type { Level } from "./permissions";

export const NOTIFY_KINDS = ["report", "reminders"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Telegram chat ids: users are positive, groups/supergroups negative (e.g. -100…). */
export const CHAT_ID_RE = /^-?\d{1,20}$/;

/** Trimmed chat id, or null when it is not a Telegram numeric chat id ("0"/"-0" refused). */
export function normalizeChatId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!CHAT_ID_RE.test(s) || /^-?0+$/.test(s)) return null;
  return s;
}

/** i18n error key for a chat id input, or null when valid. */
export function chatIdProblem(raw: string): string | null {
  if (!raw.trim()) return "Chat ID wajib diisi";
  return normalizeChatId(raw) ? null : "Chat ID harus berupa angka (grup diawali tanda minus)";
}

export function isNotifyKind(v: unknown): v is NotifyKind {
  return typeof v === "string" && (NOTIFY_KINDS as readonly string[]).includes(v);
}

/** Wallet ids a member may view, from their grants (view or manage). */
export function viewableWallets(grants: Readonly<Record<string, Level>>): string[] {
  return Object.entries(grants)
    .filter(([, l]) => l === "view" || l === "manage")
    .map(([id]) => id)
    .sort();
}

/**
 * Effective notification scope: the member's viewable wallets, narrowed by `subset` when it is
 * non-empty. Ids outside the viewable set are dropped (revoked access wins over the checklist).
 */
export function notifyScope(
  grants: Readonly<Record<string, Level>>,
  subset: readonly string[] | null | undefined,
): string[] {
  const view = viewableWallets(grants);
  if (!subset?.length) return view;
  const pick = new Set(subset);
  return view.filter((id) => pick.has(id));
}

/** True when an item linked to these wallets belongs in a scoped message (null scope = all). */
export function inNotifyScope(
  scope: readonly string[] | null | undefined,
  ...accountIds: (string | null | undefined)[]
): boolean {
  if (!scope) return true;
  return accountIds.some((id) => !!id && scope.includes(id));
}

export type NotifyMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  chat_id: string;
  enabled: boolean;
  send_report: boolean;
  send_reminders: boolean;
  wallets: readonly string[];
  grants: Readonly<Record<string, Level>>;
};

export type NotifyTarget = {
  chat_id: string;
  /** null = owner (global message). */
  user_id: string | null;
  username: string | null;
  /** null = every wallet (owner); otherwise the member's effective wallet ids. */
  scope: string[] | null;
};

/**
 * Who gets a `kind` notification: the owner first (when an admin chat id is set), then each
 * enabled, active member that opted into `kind`, has a valid chat id and at least one wallet in
 * scope. Duplicate (chat, scope) pairs are sent once; a member chat equal to the owner chat is
 * skipped (the owner's message already covers every wallet).
 */
export function planRecipients(input: {
  adminChatId: string | null | undefined;
  kind: NotifyKind;
  members: readonly NotifyMember[];
}): NotifyTarget[] {
  const out: NotifyTarget[] = [];
  const seen = new Set<string>();
  const admin = normalizeChatId(input.adminChatId ?? "");
  if (admin) {
    out.push({ chat_id: admin, user_id: null, username: null, scope: null });
    seen.add(admin);
  }
  for (const m of input.members) {
    if (m.role !== "member" || !m.is_active || !m.enabled) continue;
    if (input.kind === "report" ? !m.send_report : !m.send_reminders) continue;
    const chat = normalizeChatId(m.chat_id);
    if (!chat || chat === admin) continue;
    const scope = notifyScope(m.grants, m.wallets);
    if (!scope.length) continue;
    const key = `${chat}|${scope.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chat_id: chat, user_id: m.user_id, username: m.username, scope });
  }
  return out;
}

/** Adds "👛 Dompet: A, B" under the first line of a scoped message. */
export function withWalletLine(text: string, walletNames: readonly string[]): string {
  if (!walletNames.length) return text;
  const line = `👛 Dompet: ${walletNames.join(", ")}`;
  const i = text.indexOf("\n");
  return i < 0 ? `${text}\n${line}` : `${text.slice(0, i)}\n${line}${text.slice(i)}`;
}

/** Settings → Pengguna → Notifikasi: what the admin saves for one member. */
export const notifyRecipientSchema = z.object({
  user_id: z.string().uuid(),
  chat_id: z
    .string()
    .max(40)
    .refine((v) => normalizeChatId(v) !== null, { message: "Chat ID tidak valid" })
    .transform((v) => normalizeChatId(v)!),
  enabled: z.boolean(),
  send_report: z.boolean(),
  send_reminders: z.boolean(),
  wallets: z.array(z.string().uuid()).max(500),
});
export type NotifyRecipientInput = z.output<typeof notifyRecipientSchema>;
