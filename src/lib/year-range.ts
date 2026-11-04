/** Pure year range math for multi-year aggregations. */

export type YearRange = "1" | "5" | "10" | "custom";

export function currentYear(): number {
  return new Date().getUTCFullYear();
}

export function yearRangeYears(range: YearRange, customStart?: number, customEnd?: number): number[] {
  const current = currentYear();
  
  switch (range) {
    case "1":
      return [current];
    case "5":
      return Array.from({ length: 5 }, (_, i) => current - 4 + i);
    case "10":
      return Array.from({ length: 10 }, (_, i) => current - 9 + i);
    case "custom": {
      if (!customStart || !customEnd) return [current];
      const start = Math.min(customStart, customEnd);
      const end = Math.max(customStart, customEnd);
      if (end - start > 20) return [current]; // Cap at 20 years
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
}

export function validateYearRange(start: unknown, end: unknown): { start: number; end: number } | null {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e)) return null;
  if (s < 2000 || s > 2100 || e < 2000 || e > 2100) return null;
  const min = Math.min(s, e);
  const max = Math.max(s, e);
  if (max - min > 20) return null; // Max 20 years
  return { start: min, end: max };
}
