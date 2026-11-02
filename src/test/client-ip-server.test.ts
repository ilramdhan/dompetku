/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* #118 M1: without a client address the per-IP rule is skipped (no shared "unknown" bucket). */
const logged: string[] = [];
vi.mock("../lib/monitoring.server", () => ({
  logError: (scope: string) => logged.push(scope),
}));
const rateCalls: string[] = [];
let allow = true;
vi.mock("../lib/rate-limit.server", () => ({
  subjectHash: (v: string) => v,
  rateHit: async (_r: any, s: string) => (rateCalls.push(s), allow),
}));
vi.mock("../lib/invoice-share.server", () => ({
  activeShareInvoiceId: async () => null,
  hashShareToken: (t: string) => `h(${t})`,
}));

import { ipRateSubject, resetIpRateSubjectLog } from "@/lib/client-ip.server";
import { UNKNOWN_IP } from "@/lib/client-ip";
import {
  PAY_RATE_LIMITED,
  PAY_UNAVAILABLE,
  startGatewayPayment,
} from "@/lib/gateway/payments.server";
import { demoRateLimit } from "@/lib/demo.server";

const TOKEN = "A".repeat(43);

beforeEach(() => {
  logged.length = 0;
  rateCalls.length = 0;
  allow = true;
  resetIpRateSubjectLog();
});

describe("ipRateSubject", () => {
  it("returns the bucket key and logs an unknown address once", () => {
    expect(ipRateSubject("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(ipRateSubject(UNKNOWN_IP)).toBeNull();
    expect(ipRateSubject(UNKNOWN_IP)).toBeNull();
    expect(logged).toEqual(["client-ip:unknown"]);
  });
});

describe("pay button with no client address", () => {
  it("skips the per-IP rule but still applies the per-token rule", async () => {
    await expect(startGatewayPayment(TOKEN, UNKNOWN_IP, null)).rejects.toThrow(PAY_UNAVAILABLE);
    expect(rateCalls).toEqual([`token:h(${TOKEN})`]);
    allow = false;
    await expect(startGatewayPayment(TOKEN, UNKNOWN_IP, null)).rejects.toThrow(PAY_RATE_LIMITED);
  });
  it("buckets IPv6 clients by /64", async () => {
    await expect(startGatewayPayment(TOKEN, "2001:db8:1:2::77", null)).rejects.toThrow();
    expect(rateCalls[0]).toBe("ip:2001:db8:1:2::/64");
  });
});

describe("demo write limit with no client address", () => {
  it("never puts unknown visitors into one shared bucket", () => {
    const prev = process.env["DEMO_MODE"];
    process.env["DEMO_MODE"] = "true";
    try {
      const req = () => new Request("https://x/_serverFn/abc", { method: "POST" });
      for (let i = 0; i < 500; i++) expect(demoRateLimit(req(), "serverFn")).toBeNull();
      // A known address is still limited.
      const known = () => {
        const r = req();
        Object.defineProperty(r, "ip", { value: "203.0.113.9" });
        return r;
      };
      let limited = false;
      for (let i = 0; i < 500 && !limited; i++)
        limited = demoRateLimit(known(), "serverFn") !== null;
      expect(limited).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["DEMO_MODE"];
      else process.env["DEMO_MODE"] = prev;
    }
  });
});
