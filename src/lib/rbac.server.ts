/**
 * Server-side RBAC enforcement helpers (v18). Every member-accessible server fn calls these with
 * its `requireAuth` context; nothing here trusts client input. Pure rules live in permissions.ts.
 * For the owner (admin) every helper is a no-op / returns null (= all), so single-user installs
 * behave exactly as before.
 */
import { db } from "./db.server";
import {
  allowedAccountIds,
  canViewTx,
  canWriteTx,
  isAdmin,
  manageableAccountIds,
  maskTx,
  type Access,
} from "./permissions";
import { isOwnReceiptPath, receiptPaths } from "./receipts";

type Ctx = { access: Access; userId: string | null };

/** Account ids the caller may see; null = all (admin). The single data-scoping entry point. */
export function accountScope(ctx: Ctx): string[] | null {
  return allowedAccountIds(ctx.access);
}

export function assertAdmin(ctx: Ctx): void {
  if (!isAdmin(ctx.access)) throw new Error("Akses ditolak");
}

export function assertWalletView(ctx: Ctx, accountId: string): void {
  if (isAdmin(ctx.access)) return;
  const ids = allowedAccountIds(ctx.access) ?? [];
  // Same message as a missing account so ids of other wallets cannot be probed.
  if (!ids.includes(accountId)) throw new Error("Akun tidak ditemukan");
}

/** Members need at least one wallet with `manage` to upload receipt photos. */
export function assertCanWriteSomewhere(ctx: Ctx): void {
  if (isAdmin(ctx.access)) return;
  if (!(manageableAccountIds(ctx.access) ?? []).length) throw new Error("Akses ditolak");
}

/** Hides non-permitted wallets on transaction rows (no-op for admins). */
export function maskRows<T extends Record<string, unknown>>(ctx: Ctx, rows: T[]): T[] {
  if (isAdmin(ctx.access)) return rows;
  return rows.map((r) => maskTx(ctx.access, r as never) as T);
}

type TxRow = {
  id: string;
  kind: string;
  account_id: string | null;
  to_account_id: string | null;
  receipt_path?: string | null;
  receipt_paths?: string[] | null;
  split_group?: string | null;
};

/** Loads a transaction the caller may see; "not found" otherwise (no existence leak). */
export async function loadVisibleTx(ctx: Ctx, id: string): Promise<TxRow> {
  const res = await db().from("transactions").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as TxRow | null;
  if (!row || !canViewTx(ctx.access, row)) throw new Error("Transaksi tidak ditemukan");
  return row;
}

/** Throws unless the caller may write a transaction with these sides (both, for transfers). */
export function assertTxWrite(
  ctx: Ctx,
  tx: { kind?: string | null; account_id?: string | null; to_account_id?: string | null },
): void {
  if (isAdmin(ctx.access)) return;
  const sides = {
    kind: tx.kind ?? null,
    account_id: tx.account_id ?? null,
    to_account_id: tx.kind === "transfer" ? (tx.to_account_id ?? null) : null,
  };
  if (!canWriteTx(ctx.access, sides)) throw new Error("Akses ditolak");
}

/** Edit/delete: the caller needs manage on the existing row's wallets (old sides). */
export async function assertTxIdWrite(ctx: Ctx, id: string): Promise<TxRow> {
  const row = await loadVisibleTx(ctx, id);
  assertTxWrite(ctx, row);
  return row;
}

/** Storage prefix for receipts uploaded by a member (lets them preview before saving). */
export function memberReceiptPrefix(userId: string): string {
  return `m/${userId}/`;
}

/**
 * Members may attach only photos they uploaded themselves (own prefix) or that the edited row
 * already had — never paths of transactions on other wallets.
 */
export function assertReceiptPathsAllowed(
  ctx: Ctx,
  paths: readonly (string | null | undefined)[],
  previous?: TxRow | null,
): void {
  if (isAdmin(ctx.access)) return;
  const prev = new Set(previous ? receiptPaths(previous as never) : []);
  for (const p of paths) {
    if (!p) continue;
    if (prev.has(p)) continue;
    if (isOwnReceiptPath(p, ctx.userId)) continue;
    throw new Error("Akses ditolak");
  }
}

/**
 * Signed receipt URLs for members: the path must be their own upload or belong to a
 * transaction on a wallet they can see.
 */
export async function assertReceiptView(ctx: Ctx, path: string): Promise<void> {
  if (isAdmin(ctx.access)) return;
  if (isOwnReceiptPath(path, ctx.userId)) return;
  const ids = allowedAccountIds(ctx.access) ?? [];
  if (!ids.length) throw new Error("Akses ditolak");
  const { txScopeFilter } = await import("./permissions");
  const one = await db()
    .from("transactions")
    .select("id")
    .eq("receipt_path", path)
    .or(txScopeFilter(ids))
    .limit(1);
  if (!one.error && one.data?.length) return;
  const arr = await db()
    .from("transactions")
    .select("id")
    .contains("receipt_paths", [path])
    .or(txScopeFilter(ids))
    .limit(1);
  if (!arr.error && arr.data?.length) return;
  throw new Error("Akses ditolak");
}
