/**
 * Subscription interval helpers (v20).
 * Pure functions for next-due calculation and monthly cost conversion.
 */

/** Convert subscription amount to monthly equivalent. */
export function subMonthly(amount: number, cycle: "monthly" | "yearly", interval: number): number {
  if (cycle === "monthly") return amount / interval;
  return amount / (interval * 12);
}

/** Calculate months between cycles. */
export function subMonths(cycle: "monthly" | "yearly", interval: number): number {
  return cycle === "monthly" ? interval : interval * 12;
}

/**
 * Calculate next due date from last due + interval.
 * @param cycle monthly or yearly
 * @param interval every N cycles
 * @param lastDue ISO date string (YYYY-MM-DD)
 * @returns ISO date string
 */
export function subNextDue(
  cycle: "monthly" | "yearly",
  interval: number,
  lastDue: string,
): string {
  const d = new Date(lastDue + "T00:00:00Z");
  const months = subMonths(cycle, interval);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
