/**
 * Central, pure permission model (client-safe, unit-tested). The server is the only enforcer:
 * `requireAuth` builds an `Access` subject per request (users.server.ts) and every server fn either
 * requires admin (`requireAdmin`) or scopes its data with the helpers below. The client uses the
 * same helpers only to hide buttons/routes.
 *
 * Model
 * - Roles: `admin` (the APP_USERNAME owner) has every capability; `member` gets the default
 *   capabilities in ROLE_CAPABILITIES plus per-wallet grants.
 * - Permission strings: `wallet:view` / `wallet:manage` (resource = account id) and
 *   `module:<name>` (resource ignored). New, finer-grained permissions are added as new strings
 *   (and, when they need per-resource grants, a new grant table keyed like account_permissions)
 *   without changing callers: everything goes through `can()`.
 * - Wallet grants (v18 `account_permissions`): `view` = see the wallet, its balance, transactions
 *   and report; `manage` = also create/edit/delete transactions on it. Transfers need `manage` on
 *   both sides.
 */
export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];
export const LEVELS = ["view", "manage"] as const;
export type Level = (typeof LEVELS)[number];

/** Modules a member may open (everything else is admin-only). */
export const MEMBER_MODULES = [
  "dashboard",
  "transactions",
  "accounts",
  "reports",
  "profile",
] as const;
/** Admin-only modules (pages, the bot and the n8n API). Listed so they can be granted later. */
export const ADMIN_MODULES = [
  "debts",
  "goals",
  "gold",
  "receivables",
  "budgets",
  "recurring",
  "subscriptions",
  "reminders",
  "rekap",
  "settings",
  "integrations",
  "backup",
  "import",
  "activity",
  "users",
  "categories",
  "ocr",
  "bot",
  "n8n",
] as const;
export type ModuleName = (typeof MEMBER_MODULES)[number] | (typeof ADMIN_MODULES)[number];
export type Permission = "wallet:view" | "wallet:manage" | `module:${ModuleName}`;

/** Default capabilities per role. `*` = everything. */
export const ROLE_CAPABILITIES: Record<Role, readonly string[]> = {
  admin: ["*"],
  member: MEMBER_MODULES.map((m) => `module:${m}`),
};

/** The subject of a permission check (built server-side per request). */
export type Access = {
  role: Role;
  /** Wallet grants for members: account id → level. Ignored for admins. */
  grants: Readonly<Record<string, Level>>;
};

export const ADMIN_ACCESS: Access = { role: "admin", grants: {} };

export const isAdmin = (a: Access | null | undefined): boolean => a?.role === "admin";

/** The single permission resolver. Fails closed for unknown roles/permissions. */
export function can(
  subject: Access | null | undefined,
  permission: Permission,
  resource?: string | null,
): boolean {
  if (!subject) return false;
  if (subject.role === "admin") return true;
  if (subject.role !== "member") return false;
  if (permission === "wallet:view" || permission === "wallet:manage") {
    if (!resource) return false;
    const level = Object.prototype.hasOwnProperty.call(subject.grants, resource)
      ? subject.grants[resource]
      : undefined;
    if (permission === "wallet:view") return level === "view" || level === "manage";
    return level === "manage";
  }
  return ROLE_CAPABILITIES.member.includes(permission);
}

/** Account ids the subject may see; null = every account (admin). */
export function allowedAccountIds(a: Access | null | undefined): string[] | null {
  if (!a) return [];
  if (a.role === "admin") return null;
  return Object.keys(a.grants)
    .filter((id) => can(a, "wallet:view", id))
    .sort();
}

/** Account ids the subject may write transactions on; null = every account (admin). */
export function manageableAccountIds(a: Access | null | undefined): string[] | null {
  if (!a) return [];
  if (a.role === "admin") return null;
  return Object.keys(a.grants)
    .filter((id) => can(a, "wallet:manage", id))
    .sort();
}

type TxSides = {
  kind?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
};

/** Whether the subject may see a transaction (it touches at least one visible wallet). */
export function canViewTx(a: Access | null | undefined, tx: TxSides): boolean {
  if (isAdmin(a)) return true;
  return can(a, "wallet:view", tx.account_id) || can(a, "wallet:view", tx.to_account_id);
}

/**
 * Whether the subject may create/edit/delete a transaction with these sides. Members need
 * `manage` on the account, and on the destination too for transfers; a transaction without an
 * account is admin-only.
 */
export function canWriteTx(a: Access | null | undefined, tx: TxSides): boolean {
  if (isAdmin(a)) return true;
  if (!can(a, "wallet:manage", tx.account_id)) return false;
  if (tx.to_account_id && !can(a, "wallet:manage", tx.to_account_id)) return false;
  if (tx.kind === "transfer" && !tx.to_account_id) return false;
  return true;
}

/** Label shown instead of a wallet the member may not see (i18n key). */
export const OTHER_WALLET = "Dompet lain";

type NamedAccount = { id?: string | null; name?: string | null; masked?: boolean } | null;
type MaskableTx = TxSides & {
  account?: NamedAccount;
  to_account?: NamedAccount;
  pocket_id?: string | null;
};

/**
 * Hides wallets the subject may not see on a (visible) transaction: the id is cleared and the
 * name replaced by OTHER_WALLET, so transfers to/from a hidden wallet never leak its id or name.
 * Admins get the row unchanged.
 */
export function maskTx<T extends MaskableTx>(a: Access | null | undefined, tx: T): T {
  if (isAdmin(a)) return tx;
  const out: T = { ...tx };
  const hide = (idKey: "account_id" | "to_account_id", relKey: "account" | "to_account") => {
    const id = tx[idKey];
    if (!id || can(a, "wallet:view", id)) return;
    (out as MaskableTx)[idKey] = null;
    if (relKey in tx || id)
      (out as MaskableTx)[relKey] = { id: null, name: OTHER_WALLET, masked: true };
  };
  hide("account_id", "account");
  hide("to_account_id", "to_account");
  // v19: a Kantong belongs to the source wallet; never leak its id when that wallet is hidden.
  if (tx.account_id && !can(a, "wallet:view", tx.account_id) && "pocket_id" in tx)
    (out as MaskableTx).pocket_id = null;
  return out;
}

/** Display name of a (possibly masked) wallet on a transaction row. */
export function walletLabel(
  acc: NamedAccount | undefined,
  t: (s: string) => string = (s) => s,
  fallback = "-",
): string {
  if (!acc) return fallback;
  if (acc.masked) return t(OTHER_WALLET);
  return acc.name ?? fallback;
}

/** Never matches a real row; keeps `in.()` filters non-empty for members without grants. */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids safe to embed in a PostgREST `in.(…)` list (uuids only), never empty. */
export function scopeIds(ids: readonly string[]): string[] {
  const clean = ids.filter((id) => UUID.test(id));
  return clean.length ? clean : [NIL_UUID];
}

/** PostgREST `or` filter: transaction touches one of the ids on either side. */
export function txScopeFilter(ids: readonly string[]): string {
  const list = scopeIds(ids).join(",");
  return `account_id.in.(${list}),to_account_id.in.(${list})`;
}

/** Grants from account_permissions rows (unknown levels are dropped; manage wins on duplicates). */
export function grantsFromRows(
  rows: readonly { account_id: unknown; level: unknown }[] | null | undefined,
): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const r of rows ?? []) {
    if (typeof r.account_id !== "string" || !UUID.test(r.account_id)) continue;
    if (r.level !== "view" && r.level !== "manage") continue;
    if (out[r.account_id] !== "manage") out[r.account_id] = r.level;
  }
  return out;
}

/* ---------------- routes (UI convenience only; the server enforces) ---------------- */
const ROUTE_MODULE: Record<string, ModuleName> = {
  dashboard: "dashboard",
  transactions: "transactions",
  accounts: "accounts",
  reports: "reports",
  profile: "profile",
  rekap: "rekap",
  debts: "debts",
  goals: "goals",
  gold: "gold",
  receivables: "receivables",
  budgets: "budgets",
  recurring: "recurring",
  subscriptions: "subscriptions",
  reminders: "reminders",
  settings: "settings",
};

/** Module of an app path (`/accounts/123` → accounts); null for unknown paths. */
export function routeModule(pathname: string): ModuleName | null {
  const seg = pathname.split("?")[0]!.split("/").filter(Boolean)[0] ?? "";
  return ROUTE_MODULE[seg] ?? null;
}

/** Whether a role may open an app path. Unknown paths are admin-only. */
export function canOpenPath(role: Role | null | undefined, pathname: string): boolean {
  if (role === "admin") return true;
  const m = routeModule(pathname);
  return !!m && can({ role: role ?? "member", grants: {} }, `module:${m}`);
}

/* ---------------- member net worth (wallet subset) ---------------- */
type FlowTx = {
  kind: string;
  amount: unknown;
  account_id?: string | null;
  to_account_id?: string | null;
  occurred_at: unknown;
};

/**
 * Monthly net change (IDR) of the sum of the given wallets' balances. Uses the same flow rules
 * as the account_balances view (amounts in the wallet's currency, USD wallets × rate). Transfers
 * between two included wallets cancel out; transfers to/from other wallets count.
 */
export function walletNetByMonth(
  rows: readonly FlowTx[],
  wallets: ReadonlyMap<string, { currency: string }>,
  usdIdr: number,
): { month: string; net: number }[] {
  const m = new Map<string, number>();
  const rate = (id: string) => (wallets.get(id)?.currency === "USD" ? usdIdr : 1);
  for (const t of rows) {
    const v = Number(t.amount) || 0;
    let delta = 0;
    const from = t.account_id && wallets.has(t.account_id) ? t.account_id : null;
    const to = t.to_account_id && wallets.has(t.to_account_id) ? t.to_account_id : null;
    if (from) {
      if (t.kind === "income") delta += v * rate(from);
      else if (t.kind === "expense" || t.kind === "transfer") delta -= v * rate(from);
    }
    if (to && t.kind === "transfer" && t.to_account_id !== t.account_id) delta += v * rate(to);
    if (!delta) continue;
    const month = String(t.occurred_at).slice(0, 7);
    m.set(month, (m.get(month) ?? 0) + delta);
  }
  return [...m.entries()]
    .map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}
