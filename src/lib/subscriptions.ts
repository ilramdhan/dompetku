import { addMonthsKeepDay } from "./dates";
import { monthlyEquivalent } from "./recurring";

export type SubCycle = "monthly" | "yearly";

export const subInterval = (n: number | null | undefined) => Math.max(1, Math.floor(Number(n) || 1));

export const subMonths = (cycle: SubCycle, interval?: number | null) =>
  (cycle === "yearly" ? 12 : 1) * subInterval(interval);

export const subMonthly = (amount: number, cycle: SubCycle, interval?: number | null) =>
  monthlyEquivalent(amount, cycle, subInterval(interval));

export const subNextDue = (due: string, cycle: SubCycle, interval?: number | null) =>
  addMonthsKeepDay(due, subMonths(cycle, interval));
