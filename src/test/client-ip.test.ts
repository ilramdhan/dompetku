import { describe, expect, it } from "vitest";
import {
  clientIp,
  forwardedChain,
  ipRateKey,
  normalizeIp,
  parseCidr,
  parseTrustedProxy,
  resolveClientIp,
  UNKNOWN_IP,
} from "@/lib/client-ip";

const reqWith = (ip: string | undefined, xff?: string) => {
  const r = new Request("https://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
  if (ip !== undefined) Object.defineProperty(r, "ip", { value: ip });
  return r;
};

describe("normalizeIp", () => {
  it("accepts IPv4/IPv6 with ports, brackets, zones and mapped addresses", () => {
    expect(normalizeIp(" 1.2.3.4 ")).toBe("1.2.3.4");
    expect(normalizeIp("1.2.3.4:8080")).toBe("1.2.3.4");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("1:2:3:4:5:6:7:8")).toBe("1:2:3:4:5:6:7:8");
  });
  it("rejects invalid addresses", () => {
    for (const bad of [
      "",
      "unknown",
      "999.1.1.1",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.4.5",
      "1::2::3",
      "1:2:3:4:5:6:7:8:9",
      "gggg::1",
      "<script>",
      "1.2.3.4, 5.6.7.8",
      null,
      undefined,
    ])
      expect(normalizeIp(bad)).toBeNull();
  });
});

describe("IPv6 canonical form (RFC 5952) and rate-limit keys", () => {
  it("spells the same IPv6 address one way", () => {
    expect(normalizeIp("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIp("2001:DB8::0:1")).toBe("2001:db8::1");
    expect(normalizeIp("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(normalizeIp("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
    expect(normalizeIp("0:0:0:0:0:0:0:0")).toBe("::");
    expect(normalizeIp("fe80:0:0:0:0:0:0:0")).toBe("fe80::");
  });
  it("buckets IPv6 by /64, keeps IPv4 and refuses unknown", () => {
    expect(ipRateKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:0db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:db8:1:3::1")).not.toBe(ipRateKey("2001:db8:1:2::1"));
    expect(ipRateKey("203.0.113.5")).toBe("203.0.113.5");
    expect(ipRateKey("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(ipRateKey(UNKNOWN_IP)).toBeNull();
    expect(ipRateKey("")).toBeNull();
  });
});

describe("parseCidr / parseTrustedProxy", () => {
  it("parses CIDRs and bare hosts", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ v6: false, base: 10n << 24n, bits: 8 });
    expect(parseCidr("192.168.1.9")?.bits).toBe(32);
    expect(parseCidr("fd00::/8")?.v6).toBe(true);
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("10.0.0.0/x")).toBeNull();
    expect(parseCidr("nope/8")).toBeNull();
  });
  it("is off by default and for invalid values", () => {
    for (const v of [undefined, "", "  ", "0", "11", "-1", "abc", "300.1.1.1/8"])
      expect(parseTrustedProxy(v)).toEqual({ kind: "none" });
  });
  it("parses hop counts, lists and aliases", () => {
    expect(parseTrustedProxy("2")).toEqual({ kind: "hops", hops: 2 });
    const t = parseTrustedProxy("loopback, 172.16.0.0/12 bogus");
    expect(t.kind).toBe("cidrs");
    if (t.kind === "cidrs") expect(t.ranges).toHaveLength(3);
    const p = parseTrustedProxy("private");
    if (p.kind === "cidrs") expect(p.ranges).toHaveLength(4);
  });
  it("splits X-Forwarded-For", () => {
    expect(forwardedChain(" a , ,b,c ")).toEqual(["a", "b", "c"]);
    expect(forwardedChain(null)).toEqual([]);
  });
});

describe("resolveClientIp", () => {
  const none = parseTrustedProxy("");
  it("ignores X-Forwarded-For without a trusted proxy (default)", () => {
    expect(resolveClientIp("6.6.6.6", "203.0.113.5", none)).toBe("203.0.113.5");
    expect(resolveClientIp("6.6.6.6", undefined, none)).toBe(UNKNOWN_IP);
    expect(resolveClientIp(null, "garbage", none)).toBe(UNKNOWN_IP);
  });
  it("hop count: takes the N-th entry from the right", () => {
    const one = parseTrustedProxy("1");
    const two = parseTrustedProxy("2");
    // Client forged "6.6.6.6"; the single trusted proxy appended the real peer 198.51.100.7.
    expect(resolveClientIp("6.6.6.6, 198.51.100.7", "10.0.0.2", one)).toBe("198.51.100.7");
    expect(resolveClientIp("6.6.6.6, 198.51.100.7, 10.0.0.9", "10.0.0.2", two)).toBe(
      "198.51.100.7",
    );
    // Fewer entries than hops (proxy bypassed) → connection address.
    expect(resolveClientIp("6.6.6.6", "10.0.0.2", two)).toBe("10.0.0.2");
    expect(resolveClientIp(null, "10.0.0.2", one)).toBe("10.0.0.2");
    // Invalid entry at the trusted position never becomes the client.
    expect(resolveClientIp("1.1.1.1, nonsense", "10.0.0.2", one)).toBe("10.0.0.2");
  });
  it("hop count: reads X-Forwarded-For only from a loopback/private peer", () => {
    const one = parseTrustedProxy("1");
    // Directly reachable port: public peer with a forged header → the peer itself.
    expect(resolveClientIp("6.6.6.6", "203.0.113.5", one)).toBe("203.0.113.5");
    expect(resolveClientIp("6.6.6.6", "2001:db8::5", one)).toBe("2001:db8::5");
    // Loopback / private / IPv4-mapped loopback peers are proxies.
    expect(resolveClientIp("198.51.100.7", "127.0.0.1", one)).toBe("198.51.100.7");
    expect(resolveClientIp("198.51.100.7", "::1", one)).toBe("198.51.100.7");
    expect(resolveClientIp("198.51.100.7", "::ffff:172.17.0.1", one)).toBe("198.51.100.7");
    expect(resolveClientIp("198.51.100.7", "fd00::2", one)).toBe("198.51.100.7");
    expect(resolveClientIp("198.51.100.7", undefined, one)).toBe(UNKNOWN_IP);
  });
  it("CIDR list: walks right to left past trusted proxies", () => {
    const t = parseTrustedProxy("10.0.0.0/8, loopback");
    expect(resolveClientIp("6.6.6.6, 198.51.100.7, 10.1.2.3", "127.0.0.1", t)).toBe("198.51.100.7");
    // Direct connection from an untrusted peer: its forged header is ignored.
    expect(resolveClientIp("6.6.6.6", "203.0.113.5", t)).toBe("203.0.113.5");
    // Everything trusted → the left-most address.
    expect(resolveClientIp("10.0.0.5", "10.0.0.1", t)).toBe("10.0.0.5");
    // Garbage behind a trusted proxy → keep the proxy.
    expect(resolveClientIp("6.6.6.6, bad", "10.0.0.1", t)).toBe("10.0.0.1");
    // IPv4-mapped peers and IPv6 ranges match.
    expect(resolveClientIp("2001:db8::9", "::ffff:10.0.0.1", t)).toBe("2001:db8::9");
    expect(resolveClientIp("2001:db8::9", "fd00::1", parseTrustedProxy("fc00::/7"))).toBe(
      "2001:db8::9",
    );
    expect(resolveClientIp("1.2.3.4", undefined, t)).toBe(UNKNOWN_IP);
  });
});

describe("clientIp", () => {
  it("uses request.ip and ignores spoofed headers by default", () => {
    expect(clientIp(reqWith("203.0.113.5", "6.6.6.6"))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" }))).toBe(
      UNKNOWN_IP,
    );
    expect(clientIp(reqWith(undefined))).toBe(UNKNOWN_IP);
  });
  it("a spoofed X-Forwarded-For does not change the rate-limit key behind a trusted proxy", () => {
    const t = parseTrustedProxy("1");
    const a = clientIp(reqWith("10.0.0.2", "198.51.100.7"), t);
    const b = clientIp(reqWith("10.0.0.2", "6.6.6.6, 198.51.100.7"), t);
    expect(a).toBe("198.51.100.7");
    expect(b).toBe(a);
  });
});
