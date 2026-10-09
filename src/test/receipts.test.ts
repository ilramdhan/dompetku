import { describe, expect, it } from "vitest";
import { MAX_RECEIPTS, isOwnReceiptPath, receiptColumns, receiptPaths } from "../lib/receipts";

describe("receiptPaths", () => {
  it("falls back to legacy receipt_path", () => {
    expect(receiptPaths({ receipt_path: "a.jpg" })).toEqual(["a.jpg"]);
    expect(receiptPaths({ receipt_path: null, receipt_paths: null })).toEqual([]);
    expect(receiptPaths(null)).toEqual([]);
  });
  it("merges, dedupes and caps", () => {
    expect(receiptPaths({ receipt_path: "a", receipt_paths: ["a", "b"] })).toEqual(["a", "b"]);
    expect(receiptPaths({ receipt_path: "z", receipt_paths: ["a"] })).toEqual(["z", "a"]);
    const many = Array.from({ length: 8 }, (_, i) => `p${i}`);
    expect(receiptPaths({ receipt_paths: many })).toHaveLength(MAX_RECEIPTS);
  });
});

describe("receiptColumns", () => {
  it("keeps receipt_path as the first photo", () => {
    expect(receiptColumns(["a", "b", "a"])).toEqual({
      receipt_path: "a",
      receipt_paths: ["a", "b"],
    });
    expect(receiptColumns([])).toEqual({ receipt_path: null, receipt_paths: null });
  });
});

describe("isOwnReceiptPath (v18)", () => {
  const U = "0b9c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
  const F = "2026-10/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg";
  it("accepts exactly the member's own upload shape", () => {
    expect(isOwnReceiptPath(`m/${U}/${F}`, U)).toBe(true);
  });
  it("rejects other prefixes, missing users and traversal tricks", () => {
    expect(isOwnReceiptPath(F, U)).toBe(false);
    expect(isOwnReceiptPath(`m/${U}/${F}`, null)).toBe(false);
    expect(isOwnReceiptPath(`m/other/${F}`, U)).toBe(false);
    expect(isOwnReceiptPath(`m/${U}/../${F}`, U)).toBe(false);
    expect(isOwnReceiptPath(`m/${U}/%2e%2e/%2e%2e/${F}`, U)).toBe(false);
    expect(isOwnReceiptPath(`m/${U}/x/../../${F}`, U)).toBe(false);
    expect(isOwnReceiptPath(`m/${U}/${F}?x`, U)).toBe(false);
  });
});
