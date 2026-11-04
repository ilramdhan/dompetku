/**
 * Client IP resolution with an explicit trusted-proxy setting (issue #118) — pure, client-safe.
 *
 * `X-Forwarded-For` is only a list of addresses that clients and proxies appended; anything left
 * of the hops you control can be forged. So by default (TRUSTED_PROXY unset) it is ignored and the
 * address the runtime reports for the connection (`request.ip`) is used:
 * - Vercel: set by the platform from the edge's own X-Forwarded-For (Vercel overwrites it),
 * - Cloudflare (Lovable): `cf-connecting-ip`,
 * - Node/Docker: the socket peer (your reverse proxy, if any — then configure TRUSTED_PROXY).
 *
 * TRUSTED_PROXY accepts either
 * - a hop count `1`..`10`: that many proxies in front of the app each append their peer to
 *   X-Forwarded-For, so the client is the N-th entry from the right (fewer entries = connection
 *   address). The header is only read when the connection comes from a loopback/private address
 *   (a proxy), so a directly reachable port cannot be spoofed; or
 * - a comma list of IPs/CIDRs (plus `loopback`, `private`): X-Forwarded-For is walked right to left
 *   starting at the socket peer, skipping trusted addresses; the first untrusted one is the client.
 * Invalid tokens are ignored; nothing valid = unset. Invalid addresses never become the client.
 */

export type TrustedProxy =
  { kind: "none" } | { kind: "hops"; hops: number } | { kind: "cidrs"; ranges: readonly IpRange[] };

export type IpRange = { v6: boolean; base: bigint; bits: number };

export const NO_TRUSTED_PROXY: TrustedProxy = { kind: "none" };
export const MAX_TRUSTED_HOPS = 10;
/** Returned when no usable address is known; never used as a rate-limit bucket (`ipRateKey`). */
export const UNKNOWN_IP = "unknown";

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  private: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

type ParsedIp = { v6: boolean; value: bigint; text: string };

/** RFC 5952 text: lower-case hex, no leading zeros, longest (≥ 2) zero run as `::`, first wins. */
function formatV6(value: bigint): string {
  const words = Array.from({ length: 8 }, (_, i) =>
    Number((value >> BigInt((7 - i) * 16)) & 0xffffn),
  );
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (ws: number[]) => ws.map((w) => w.toString(16)).join(":");
  if (best === -1) return hex(words);
  return `${hex(words.slice(0, best))}::${hex(words.slice(best + bestLen))}`;
}

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255 || (p.length > 1 && p.startsWith("0"))) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(s: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.length > 45) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(halves[0] ?? "");
  const tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  const words: number[] = [];
  const push = (list: string[], last: boolean): boolean => {
    for (let i = 0; i < list.length; i++) {
      const g = list[i] ?? "";
      if (last && i === list.length - 1 && g.includes(".")) {
        const v4 = parseV4(g);
        if (v4 === null) return false;
        words.push(Number(v4 >> 16n), Number(v4 & 0xffffn));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
        words.push(parseInt(g, 16));
      }
    }
    return true;
  };
  if (!push(head, halves.length === 1)) return null;
  const headLen = words.length;
  if (!push(tail, true)) return null;
  if (halves.length === 1) {
    if (words.length !== 8) return null;
  } else {
    const missing = 8 - words.length;
    if (missing < 1) return null;
    words.splice(headLen, 0, ...Array<number>(missing).fill(0));
  }
  let v = 0n;
  for (const w of words) v = (v << 16n) | BigInt(w);
  return v;
}

/**
 * Parses one address as found in headers/sockets: trims, strips a port (`1.2.3.4:80`,
 * `[::1]:80`), brackets and an IPv6 zone, and unwraps IPv4-mapped IPv6 (`::ffff:1.2.3.4`).
 */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  let s = (raw ?? "").trim();
  if (!s || s.length > 64) return null;
  const bracket = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(s);
  if (bracket) s = bracket[1] ?? "";
  else if (/^[\d.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const v4 = parseV4(s);
  if (v4 !== null) return { v6: false, value: v4, text: s };
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) {
    const n = v6 & 0xffffffffn;
    const text = [24n, 16n, 8n, 0n].map((b) => String((n >> b) & 0xffn)).join(".");
    return { v6: false, value: n, text };
  }
  return { v6: true, value: v6, text: formatV6(v6) };
}

/** Normalised address text, or null when `raw` is not a valid IPv4/IPv6 address. */
export function normalizeIp(raw: string | null | undefined): string | null {
  return parseIp(raw)?.text ?? null;
}

/** `10.0.0.0/8`, `::1/128` or a bare address (= single host). Null when invalid. */
export function parseCidr(raw: string): IpRange | null {
  const [addr, len, extra] = raw.trim().split("/");
  if (extra !== undefined || !addr) return null;
  const ip = parseIp(addr);
  if (!ip || ip.text.includes(":") !== ip.v6) return null;
  const max = ip.v6 ? 128 : 32;
  let bits = max;
  if (len !== undefined) {
    if (!/^\d{1,3}$/.test(len)) return null;
    bits = Number(len);
    if (bits > max) return null;
  }
  const shift = BigInt(max - bits);
  return { v6: ip.v6, base: (ip.value >> shift) << shift, bits };
}

function inRange(ip: ParsedIp, r: IpRange): boolean {
  if (ip.v6 !== r.v6) return false;
  const shift = BigInt((r.v6 ? 128 : 32) - r.bits);
  return ip.value >> shift === r.base >> shift;
}

const PROXY_PEER_RANGES: readonly IpRange[] = [
  ...(ALIASES["loopback"] ?? []),
  ...(ALIASES["private"] ?? []),
]
  .map(parseCidr)
  .filter((r): r is IpRange => r !== null);

/**
 * Per-IP rate-limit key: IPv4 as is, IPv6 bucketed by its /64 (one client usually controls a
 * whole /64). Null for UNKNOWN_IP/invalid input — callers then skip the per-IP rule instead of
 * putting every visitor into one shared bucket (other limits, e.g. per token, still apply).
 */
export function ipRateKey(ip: string | null | undefined): string | null {
  const p = parseIp(ip);
  if (!p) return null;
  if (!p.v6) return p.text;
  return `${formatV6((p.value >> 64n) << 64n)}/64`;
}

/** Parses the TRUSTED_PROXY value. Empty/invalid = `{ kind: "none" }` (X-Forwarded-For ignored). */
export function parseTrustedProxy(raw: string | null | undefined): TrustedProxy {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return NO_TRUSTED_PROXY;
  if (/^\d+$/.test(s)) {
    const hops = Number(s);
    return hops >= 1 && hops <= MAX_TRUSTED_HOPS ? { kind: "hops", hops } : NO_TRUSTED_PROXY;
  }
  const ranges: IpRange[] = [];
  for (const token of s.split(/[\s,]+/).filter(Boolean)) {
    for (const item of ALIASES[token] ?? [token]) {
      const r = parseCidr(item);
      if (r) ranges.push(r);
    }
  }
  return ranges.length ? { kind: "cidrs", ranges } : NO_TRUSTED_PROXY;
}

/** X-Forwarded-For entries left to right (every header line, empty items dropped). */
export function forwardedChain(header: string | null | undefined): string[] {
  return (header ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-64);
}

/**
 * The client address for rate limiting. `remote` is the connection address reported by the
 * runtime (`request.ip`). Without a trusted proxy X-Forwarded-For and X-Real-IP are ignored.
 */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  remote: string | null | undefined,
  trust: TrustedProxy,
): string {
  const peer = parseIp(remote);
  if (trust.kind === "none") return peer?.text ?? UNKNOWN_IP;
  const chain = forwardedChain(forwardedFor);
  if (trust.kind === "hops") {
    // Only a proxy (loopback/private peer) may supply the header; a direct public peer is the client.
    if (!peer) return UNKNOWN_IP;
    if (!PROXY_PEER_RANGES.some((r) => inRange(peer, r))) return peer.text;
    // Fewer entries than trusted hops = a proxy was bypassed; every entry may be forged.
    if (chain.length < trust.hops) return peer.text;
    const pick = parseIp(chain[chain.length - trust.hops]);
    return pick?.text ?? peer.text;
  }
  // CIDR mode: only an address we can verify starts the walk.
  if (!peer) return UNKNOWN_IP;
  let current = peer;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!trust.ranges.some((r) => inRange(current, r))) return current.text;
    const next = parseIp(chain[i]);
    // A trusted proxy reported garbage: keep the proxy rather than a forgeable value.
    if (!next) return current.text;
    current = next;
  }
  return current.text;
}

type IpRequest = Request & { ip?: unknown };

/** Client IP of a request (or bare headers in tests, which carry no connection address). */
export function clientIp(
  source: Request | Headers,
  trust: TrustedProxy = NO_TRUSTED_PROXY,
): string {
  const headers = source instanceof Headers ? source : source.headers;
  const ip = source instanceof Headers ? undefined : (source as IpRequest).ip;
  return resolveClientIp(
    headers.get("x-forwarded-for"),
    typeof ip === "string" ? ip : undefined,
    trust,
  );
}
