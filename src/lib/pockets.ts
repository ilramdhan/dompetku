/**
 * Pure, client-safe "Kantong" (envelope) math (v19). Shared by pockets.server.ts, the wallet
 * page, the transaction form and tests.
 *
 * A pocket earmarks part of ONE wallet's money (e.g. Mandiri → Makan 500rb). Amounts are in the
 * wallet's currency (the transaction `amount` column, like account balances).
 *
 * Semantics
 * - period "monthly": remaining = allocated − pocket expenses this month + pocket incomes this
 *   month (month in the app time zone). Each month starts fresh at `allocated`.
 * - period "none": a running envelope; every pocket transaction ever counts.
 * - A transfer OUT of the pocket's wallet may carry the pocket (counts like an expense); the
 *   receiving side of a transfer never does.
 * - unallocated = wallet balance − Σ max(0, remaining) over active pockets. It goes negative when
 *   more money is earmarked than the wallet holds (over-allocated).
 * - Alert levels: "low" when remaining ≤ min_balance (when set), "empty" when remaining ≤ 0.
 *   Each level fires at most once per pocket per month (dedupe key below).
 */
import { monthRange } from "./dates";

export const POCKET_PERIODS = ["monthly", "none"] as const;
export type PocketPeriod = (typeof POCKET_PERIODS)[number];
export type PocketLevel = "low" | "empty";

export type Pocket = {
  id: string;
  account_id: string;
  name: string;
  allocated: number | string;
  min_balance?: number | string | null;
  period?: string | null;
  icon?: string | null;
  color?: string | null;
  archived?: boolean | null;
  sort_order?: number | null;
};

export type PocketTx = {
  kind: string;
  amount: number | string | null;
  account_id?: string | null;
  pocket_id?: string | null;
  occurred_at: string;
};

export type PocketStatus = {
  spent: number;
  added: number;
  remaining: number;
  allocated: number;
  /** remaining / allocated in percent, clamped to 0…100 (0 when nothing is allocated). */
  percentLeft: number;
  level: PocketLevel | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const pocketPeriod = (p: Pick<Pocket, "period">): PocketPeriod =>
  p.period === "none" ? "none" : "monthly";

/** Date range a pocket counts for `month` (YYYY-MM); null = all time (running envelope). */
export function pocketRange(
  p: Pick<Pocket, "period">,
  month: string,
): { start: string; end: string } | null {
  return pocketPeriod(p) === "monthly" ? monthRange(month) : null;
}

/** Whether a transaction kind/side may carry a pocket of `accountId`. */
export function pocketAllowed(kind: string | null | undefined): boolean {
  return kind === "expense" || kind === "income" || kind === "transfer";
}

/**
 * Signed effect of one transaction on a pocket of wallet `accountId`: expense/transfer-out −,
 * income +. Rows on another wallet (stale pocket after an account change) count 0.
 */
export function pocketDelta(tx: PocketTx, accountId: string): number {
  if (tx.account_id !== accountId) return 0;
  const v = num(tx.amount);
  if (tx.kind === "income") return v;
  if (tx.kind === "expense" || tx.kind === "transfer") return -v;
  return 0;
}

/** Alert level for a remaining amount ("empty" wins over "low"). */
export function pocketLevel(
  remaining: number,
  minBalance: number | string | null | undefined,
): PocketLevel | null {
  if (remaining <= 0) return "empty";
  if (minBalance != null && minBalance !== "" && remaining <= num(minBalance)) return "low";
  return null;
}

/** Status of one pocket for `month` from its transactions (any order, other pockets ignored). */
export function pocketStatus(p: Pocket, txs: readonly PocketTx[], month: string): PocketStatus {
  const range = pocketRange(p, month);
  let spent = 0;
  let added = 0;
  for (const tx of txs) {
    if (tx.pocket_id !== p.id) continue;
    const day = String(tx.occurred_at).slice(0, 10);
    if (range && (day < range.start || day >= range.end)) continue;
    const d = pocketDelta(tx, p.account_id);
    if (d < 0) spent -= d;
    else added += d;
  }
  const allocated = num(p.allocated);
  const remaining = r2(allocated - spent + added);
  const percentLeft =
    allocated > 0 ? Math.max(0, Math.min(100, Math.round((remaining / allocated) * 100))) : 0;
  return {
    spent: r2(spent),
    added: r2(added),
    remaining,
    allocated,
    percentLeft,
    level: pocketLevel(remaining, p.min_balance),
  };
}

/** Money of the wallet not earmarked by any active pocket (negative = over-allocated). */
export function unallocated(
  balance: number,
  pockets: readonly { archived?: boolean | null; remaining: number }[],
): { amount: number; earmarked: number; over: boolean } {
  const earmarked = r2(
    pockets.filter((p) => !p.archived).reduce((s, p) => s + Math.max(0, p.remaining), 0),
  );
  const amount = r2(num(balance) - earmarked);
  return { amount, earmarked, over: amount < 0 };
}

/**
 * Levels crossed going from `before` to `after` remaining (alerts only fire on the way down).
 * `report` is what the user sees ("empty" alone when both are crossed at once); `claim` is what
 * gets recorded, so a later "low" never follows an "empty" in the same month.
 */
export function crossedPocketLevels(
  before: number,
  after: number,
  minBalance: number | string | null | undefined,
): { report: PocketLevel[]; claim: PocketLevel[] } {
  const hasMin = minBalance != null && minBalance !== "";
  const min = num(minBalance);
  const claim: PocketLevel[] = [];
  if (before > 0 && after <= 0) claim.push("empty");
  if (hasMin && min > 0 && before > min && after <= min) claim.push("low");
  const report: PocketLevel[] = claim.includes("empty") ? ["empty"] : claim;
  return { report, claim };
}

/** Dedupe key period: always the month, also for running envelopes (re-alert at most monthly). */
export const alertPeriod = (month: string) => month;

/** Active pockets of a wallet usable on a transaction form (sorted), or [] when none apply. */
export function selectablePockets<T extends Pocket>(
  pockets: readonly T[],
  accountId: string | null | undefined,
  kind: string | null | undefined,
): T[] {
  if (!accountId || !pocketAllowed(kind)) return [];
  return pockets
    .filter((p) => p.account_id === accountId && !p.archived)
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name, "id", { sensitivity: "base" }),
    );
}

/**
 * The pocket id to keep on a form after the account/kind changed: cleared when it no longer
 * belongs to the selected wallet (or the kind cannot carry a pocket).
 */
export function keepPocket(
  pocketId: unknown,
  pockets: readonly Pocket[],
  accountId: string | null | undefined,
  kind: string | null | undefined,
): string | null {
  if (typeof pocketId !== "string" || !pocketId) return null;
  return selectablePockets(pockets, accountId, kind).some((p) => p.id === pocketId)
    ? pocketId
    : null;
}

/**
 * Pocket value a transaction form submits. undefined = leave the stored pocket untouched (pocket
 * list not loaded yet). The pocket the edited row already had stays valid (even if archived
 * since) while the wallet is unchanged; anything else must be an active pocket of the wallet.
 */
export function pocketToSave(
  values: { pocket_id?: unknown; account_id?: unknown; kind?: unknown },
  initial: { pocket_id?: unknown; account_id?: unknown },
  pockets: readonly Pocket[],
): string | null | undefined {
  const id = typeof values.pocket_id === "string" && values.pocket_id ? values.pocket_id : null;
  if (
    id &&
    id === initial.pocket_id &&
    (values.account_id ?? null) === (initial.account_id ?? null) &&
    pocketAllowed(values.kind as string)
  )
    return id;
  if (!pockets.length) {
    // Not loaded: a moved row loses its old pocket; otherwise send what the form holds.
    if (id && id === initial.pocket_id) return null;
    return id ?? (values.pocket_id === null ? null : undefined);
  }
  return keepPocket(id, pockets, values.account_id as string, values.kind as string);
}

/**
 * Edits that change the wallet without sending a pocket must drop the old pocket (it belongs to
 * the previous wallet). Returns the value to write, or undefined to leave the column untouched.
 */
export function pocketOnEdit(
  prev: { account_id?: string | null; pocket_id?: string | null } | null,
  next: { account_id?: string | null; pocket_id?: string | null | undefined },
): string | null | undefined {
  if (next.pocket_id !== undefined) return next.pocket_id;
  if (prev?.pocket_id && prev.account_id !== (next.account_id ?? null)) return null;
  return undefined;
}

/* ---------------- bot ---------------- */
/**
 * Splits a trailing `#kantong` tag off a chat message: "kopi 25rb #makan" → text "kopi 25rb",
 * pocket "makan". Only a final tag starting with a letter ("#2" is not a tag) counts; anything else is left.
 */
export function splitPocketTag(raw: string): { text: string; pocket: string | null } {
  const m = raw.match(/^([\s\S]*?)\s+#(\p{L}[\p{L}\p{N}_-]{0,39})\s*$/u);
  if (!m || !m[1]!.trim()) return { text: raw, pocket: null };
  return { text: m[1]!.trim(), pocket: m[2]!.replace(/[_-]+/g, " ") };
}

/** Best pocket for a tag among a wallet's active pockets (exact, then prefix, then contains). */
export function matchPocket<T extends Pocket>(pockets: readonly T[], tag: string | null): T | null {
  if (!tag) return null;
  const n = tag.trim().toLowerCase();
  if (!n) return null;
  const list = pockets.filter((p) => !p.archived);
  const name = (p: T) => p.name.trim().toLowerCase();
  return (
    list.find((p) => name(p) === n) ??
    list.find((p) => name(p).startsWith(n)) ??
    list.find((p) => name(p).includes(n)) ??
    null
  );
}

const fmt = (n: number, currency = "IDR") =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(n);

export type PocketAlert = {
  pocket_id: string;
  pocket: string;
  account: string | null;
  currency: string;
  level: PocketLevel;
  remaining: number;
  allocated: number;
  min_balance: number | null;
};

/** One-line Indonesian alert text (Telegram reply). */
export function pocketAlertText(a: PocketAlert): string {
  const where = a.account ? ` (${a.account})` : "";
  return a.level === "empty"
    ? `🔴 Kantong ${a.pocket}${where} habis: sisa ${fmt(a.remaining, a.currency)} dari ${fmt(a.allocated, a.currency)}`
    : `🟠 Kantong ${a.pocket}${where} menipis: sisa ${fmt(a.remaining, a.currency)} (batas ${fmt(a.min_balance ?? 0, a.currency)})`;
}

/** Telegram lines appended to the "saved" reply ("" when there is nothing to report). */
export function pocketAlertLines(alerts: readonly PocketAlert[]): string {
  return alerts.length ? `\n${alerts.map(pocketAlertText).join("\n")}` : "";
}

/** Bot `/kantong` text from wallets with their pockets' status. */
export function pocketsText(
  wallets: readonly {
    name: string;
    currency: string;
    balance: number;
    pockets: readonly (Pocket & PocketStatus)[];
  }[],
  month: string,
): string {
  const withPockets = wallets.filter((w) => w.pockets.length);
  if (!withPockets.length) return "Belum ada kantong. Buat di web → Akun → detail dompet.";
  const bar = (pct: number) => {
    const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
    return "▓".repeat(n) + "░".repeat(10 - n);
  };
  const lines = [`👛 Kantong ${month}`];
  for (const w of withPockets) {
    lines.push("", `🏦 ${w.name}`);
    for (const p of w.pockets) {
      const flag = p.level === "empty" ? " 🔴" : p.level === "low" ? " 🟠" : "";
      lines.push(
        `• ${p.name}${flag}${pocketPeriod(p) === "none" ? " (berjalan)" : ""}`,
        `  ${bar(p.percentLeft)} sisa ${fmt(p.remaining, w.currency)} / ${fmt(p.allocated, w.currency)}`,
      );
    }
    const u = unallocated(w.balance, w.pockets);
    lines.push(
      `  Belum dialokasikan: ${fmt(u.amount, w.currency)}${u.over ? " ⚠️ alokasi melebihi saldo" : ""}`,
    );
  }
  lines.push("", "Tandai transaksi bot: kopi 25rb #makan");
  return lines.join("\n");
}
