import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { currentYear, yearRangeYears, validateYearRange, type YearRange } from "../lib/year-range";

describe("year-range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("currentYear returns current UTC year", () => {
    expect(currentYear()).toBe(2026);
  });

  it("yearRangeYears('1') returns current year only", () => {
    expect(yearRangeYears("1")).toEqual([2026]);
  });

  it("yearRangeYears('5') returns last 5 years ending with current", () => {
    expect(yearRangeYears("5")).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("yearRangeYears('10') returns last 10 years ending with current", () => {
    expect(yearRangeYears("10")).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  });

  it("yearRangeYears('custom') with valid range", () => {
    expect(yearRangeYears("custom", 2020, 2023)).toEqual([2020, 2021, 2022, 2023]);
  });

  it("yearRangeYears('custom') swaps start/end if reversed", () => {
    expect(yearRangeYears("custom", 2023, 2020)).toEqual([2020, 2021, 2022, 2023]);
  });

  it("yearRangeYears('custom') without start/end returns current", () => {
    expect(yearRangeYears("custom")).toEqual([2026]);
    expect(yearRangeYears("custom", 2020)).toEqual([2026]);
  });

  it("yearRangeYears('custom') caps at 20 years", () => {
    expect(yearRangeYears("custom", 2000, 2025)).toEqual([2026]); // 26 years → fallback
  });

  it("validateYearRange accepts valid range", () => {
    expect(validateYearRange(2020, 2025)).toEqual({ start: 2020, end: 2025 });
  });

  it("validateYearRange swaps if end < start", () => {
    expect(validateYearRange(2025, 2020)).toEqual({ start: 2020, end: 2025 });
  });

  it("validateYearRange rejects non-integers", () => {
    expect(validateYearRange(2020.5, 2025)).toBeNull();
    expect(validateYearRange("2020", 2025)).toBeNull();
  });

  it("validateYearRange rejects out of bounds", () => {
    expect(validateYearRange(1999, 2025)).toBeNull();
    expect(validateYearRange(2020, 2101)).toBeNull();
  });

  it("validateYearRange rejects > 20 year span", () => {
    expect(validateYearRange(2000, 2021)).toBeNull(); // 22 years
  });

  it("validateYearRange allows 20 year span exactly", () => {
    expect(validateYearRange(2000, 2020)).toEqual({ start: 2000, end: 2020 });
  });
});
