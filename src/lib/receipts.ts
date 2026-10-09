/** Pure, client-safe helpers for multiple receipt photos per transaction (schema v12). */

export const MAX_RECEIPTS = 5;

type WithPaths = {
  receipt_path?: string | null | undefined;
  receipt_paths?: string[] | null | undefined;
};

/** All photo paths of a row: receipt_paths when set, else the legacy single receipt_path. */
export function receiptPaths(row: WithPaths | null | undefined): string[] {
  if (!row) return [];
  const list = (row.receipt_paths ?? []).filter((p): p is string => !!p);
  const all =
    row.receipt_path && !list.includes(row.receipt_path) ? [row.receipt_path, ...list] : list;
  return [...new Set(all)].slice(0, MAX_RECEIPTS);
}

/** Columns to save for a list of paths: receipt_path is always the first (backward compatible). */
export function receiptColumns(paths: string[]): {
  receipt_path: string | null;
  receipt_paths: string[] | null;
} {
  const list = [...new Set(paths.filter(Boolean))].slice(0, MAX_RECEIPTS);
  return { receipt_path: list[0] ?? null, receipt_paths: list.length ? list : null };
}

const OWN_RECEIPT_FILE =
  /^\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

/**
 * v18: whether `path` is exactly a photo a member uploaded under their own `m/<userId>/` prefix
 * (`m/<id>/YYYY-MM/<uuid>.<ext>`, the only shape uploadReceipt produces). A strict shape, not a
 * prefix check: percent-encoded dot segments (`%2e%2e`) would otherwise be normalised by the
 * storage URL and escape the member's folder.
 */
export function isOwnReceiptPath(path: string, userId: string | null | undefined): boolean {
  if (!userId || !/^[0-9a-zA-Z-]{1,64}$/.test(userId)) return false;
  const prefix = `m/${userId}/`;
  return path.startsWith(prefix) && OWN_RECEIPT_FILE.test(path.slice(prefix.length));
}
