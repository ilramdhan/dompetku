/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed DB fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v24 (#94) server behaviour without a real database: the persistent rate limit fails closed,
 * and the public upload never touches Storage when it refuses.
 */
let rpc: (args: any) => { data: any; error: any } = () => ({ data: 1, error: null });
const uploads: string[] = [];
const MISSING = { message: "Could not find the function public.dk_rate_hit", code: "PGRST202" };

vi.mock("../lib/db.server", () => ({
  db: () => ({
    rpc: (_name: string, args: any) => Promise.resolve(rpc(args)),
    from: () => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: () => api,
        then: (res: (v: any) => void) => res({ data: null, error: null }),
      };
      return api;
    },
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async (p: string) => {
          uploads.push(p);
          return { error: null };
        },
      }),
    },
  }),
}));

import { rateHit, subjectHash } from "@/lib/rate-limit.server";
import { PROOF_RATE_LIMITED, submitProof } from "@/lib/invoice-payments.server";

const SECRET = process.env["SESSION_SECRET"];
const TOKEN = "A".repeat(43);
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0]).toString("base64")}`;
const RULE = [{ name: "t", limit: 2, windowMs: 3_600_000 }];

beforeEach(() => {
  process.env["SESSION_SECRET"] = "x".repeat(40);
  rpc = () => ({ data: 1, error: null });
  uploads.length = 0;
});
afterEach(() => {
  if (SECRET === undefined) delete process.env["SESSION_SECRET"];
  else process.env["SESSION_SECRET"] = SECRET;
});

describe("persistent rate limit", () => {
  it("hashes subjects with a server secret (never the raw value)", () => {
    const h = subjectHash("ip:1.2.3.4")!;
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("1.2.3.4");
    process.env["SESSION_SECRET"] = "y".repeat(40);
    expect(subjectHash("ip:1.2.3.4")).not.toBe(h);
    delete process.env["SESSION_SECRET"];
    expect(subjectHash("ip:1.2.3.4")).toBeNull();
  });
  it("allows within the limit and refuses above it", async () => {
    expect(await rateHit(RULE, "abc")).toBe(true);
    rpc = () => ({ data: 3, error: null });
    expect(await rateHit(RULE, "abc")).toBe(false);
  });
  it("fails closed without v24, on DB errors or without a secret", async () => {
    rpc = () => ({ data: null, error: MISSING });
    expect(await rateHit(RULE, "abc")).toBe(false);
    rpc = () => {
      throw new Error("network");
    };
    expect(await rateHit(RULE, "abc")).toBe(false);
    rpc = () => ({ data: 1, error: null });
    expect(await rateHit(RULE, null)).toBe(false);
  });
});

describe("submitProof", () => {
  const sub = {
    token: TOKEN,
    method_ref: null,
    claimed_amount: 1000,
    payer_name: null,
    note: null,
    image: JPEG,
  };
  it("refuses every upload when the rate-limit table is missing", async () => {
    rpc = () => ({ data: null, error: MISSING });
    await expect(submitProof(sub, "1.2.3.4")).rejects.toThrow(PROOF_RATE_LIMITED);
    expect(uploads).toEqual([]);
  });
  it("rejects non-image payloads before any DB access", async () => {
    let calls = 0;
    rpc = () => {
      calls++;
      return { data: 1, error: null };
    };
    await expect(
      submitProof({ ...sub, image: "data:image/svg+xml;base64,PHN2Zz4=" }, "1.2.3.4"),
    ).rejects.toThrow("Format gambar tidak didukung");
    expect(calls).toBe(0);
    expect(uploads).toEqual([]);
  });
});
