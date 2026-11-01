/**
 * Pure, client-safe rules for bank / e-wallet notifications forwarded by MacroDroid (v26, issue
 * #96). Shared by the endpoint (`payment-signals.server.ts`) and the Settings "Uji teks contoh" box,
 * so a format behaves exactly the same in the browser and on the server. Unit-tested in
 * src/test/bank-notify.test.ts.
 *
 * - Notification formats are admin-defined (table `payment_notify_formats`): which app (package /
 *   name substrings), optional title/text filter (contains or regex), an amount regex, and
 *   "must contain" / "ignore if contains" keyword lists. PRESETS are editable examples only.
 * - Admin regexes are untrusted-ish and run on attacker-controlled text (anyone can send an SMS or
 *   chat that shows up as a notification): `regexProblem()` caps length, requires them to compile
 *   and only accepts shapes that backtrack at most linearly (no quantifier inside a quantified
 *   group, no overlapping variable-length neighbours, no backreferences/lookbehind). They only ever
 *   run on text truncated to MAX_SCAN_CHARS.
 * - `parseRupiah()` reads Indonesian and international amount spellings.
 * - `matchSignal()` finds the open invoice whose remaining amount + unique code equals the amount.
 */

/* ---------------- limits ---------------- */

export const NOTIFY_LIMITS = {
  name: 60,
  match: 200,
  regex: 200,
  keywords: 300,
  app: 120,
  title: 160,
  text: 1000,
  device: 60,
  excerpt: 300,
} as const;
/** Max formats per instance. */
export const MAX_FORMATS = 50;
/** Text a regex ever sees (title + text + big text, joined), keeps worst-case backtracking small. */
export const MAX_SCAN_CHARS = 300;
/** Max unbounded quantifiers (`*`, `+`, `{n,}`) in an admin regex. */
export const MAX_UNBOUNDED = 3;
/** Max distinct character atoms (letters, escapes, classes) in an admin regex. */
export const MAX_DISTINCT_ATOMS = 40;
/** Unique code range (rupiah added to the amount to transfer). */
export const UNIQUE_CODE_MIN = 1;
export const UNIQUE_CODE_MAX = 999;
/** A notification older/newer than this (vs. the server clock) is ignored as stale. */
export const SIGNAL_MAX_AGE_MS = 48 * 3_600_000;
export const SIGNAL_MAX_FUTURE_MS = 10 * 60_000;
/** Tolerance between the invoice creation time and the notification time. */
export const INVOICE_CLOCK_SKEW_MS = 10 * 60_000;
/** Largest amount accepted from a notification. */
export const MAX_SIGNAL_AMOUNT = 1e13;

const EPS = 0.005;

/* ---------------- amounts ---------------- */

/**
 * Indonesian/international amount text → number, or null.
 * "Rp 1.250.000,00" · "Rp1.250.000" · "IDR1,250,000.00" · "1.250.000" · "Rp 50.000,-" ·
 * "Rp. 25.000" · "1250000" · "12,50". A single separator followed by exactly three digits is a
 * thousands separator (rupiah rarely has cents); with 1–2 digits it is the decimal mark.
 */
export function parseRupiah(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let s = String(raw)
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/^(?:rp\.?|idr)\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/[,.]-+$/, "")
    .replace(/[,.]$/, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s) || s.length > 25) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const i = s.lastIndexOf(dec);
    intPart = s.slice(0, i);
    frac = s.slice(i + 1);
    if (!/^\d{1,2}$/.test(frac) || intPart.includes(dec)) return null;
    if (!groupsOk(intPart, thou)) return null;
    intPart = intPart.split(thou).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]!)) {
      intPart = parts[0]!;
      frac = parts[1]!;
    } else {
      if (!groupsOk(s, sep)) return null;
      intPart = parts.join("");
    }
  }
  if (!/^\d+$/.test(intPart)) return null;
  const n = Number(`${intPart}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SIGNAL_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

/** "1.250.000" with `.`: first group 1–3 digits, every other group exactly 3. */
function groupsOk(s: string, sep: string): boolean {
  const g = s.split(sep);
  if (!/^\d{1,3}$/.test(g[0]!)) return false;
  return g.slice(1).every((x) => /^\d{3}$/.test(x));
}

/* ---------------- regex safety ---------------- */

export const REGEX_PROBLEM = {
  empty: "Regex tidak boleh kosong",
  long: "Regex terlalu panjang (maks. 200 karakter)",
  invalid: "Regex tidak valid",
  backref: "Regex tidak boleh memakai backreference",
  lookbehind: "Regex tidak boleh memakai lookbehind",
  nested: "Regex berisiko lambat (quantifier bersarang), sederhanakan polanya",
  overlap:
    "Regex berisiko lambat (dua pengulangan bisa mencocokkan karakter yang sama), sederhanakan polanya",
  unbounded: "Regex berisiko lambat (terlalu banyak * atau +), sederhanakan polanya",
  complex: "Regex terlalu rumit (terlalu banyak karakter berbeda), sederhanakan polanya",
} as const;

/**
 * Problem with an admin-supplied regex (Indonesian i18n key) or null. Compiles with the `i` flag
 * (the same flags `compileRegex` uses).
 *
 * JavaScript has no linear-time regex engine everywhere this runs (browser, Workers, Node), so
 * safety comes from the shape: a pattern passes only when every match attempt backtracks at most
 * linearly in the text length.
 * - A quantified group may contain neither a quantifier nor an alternation (`(a+)+`, `(a?){25}`,
 *   `(\d{1,30}){1,30}`, `(a|b)*` are rejected).
 * - Within one sequence, a variable-length item (`*`, `+`, `?`, `{n,m}`) must not be followed by
 *   another variable-length item that can match one of its characters, unless a mandatory item
 *   that cannot match any of its characters sits between them (`\d*\d*`, `\d+.*`, `a?a?` are
 *   rejected; `Rp\s?\d[\d.,]*`, `\d+,\d+` pass).
 * - At most MAX_UNBOUNDED `*` / `+` / `{n,}`, no backreferences or lookbehind, and the text it
 *   ever sees is cut to MAX_SCAN_CHARS.
 * - "Can match the same character" is decided on the exact code-unit set of each atom (`charSet`,
 *   all 65 536 UTF-16 units with the `i` flag), so negated classes, `[^]`, non-Latin ranges and case
 *   folding are compared exactly. `[]` / `[^]` are complete classes, as in non-`u` JavaScript.
 * JavaScript has no step budget for `RegExp`, so there is no runtime cap; the shape check is it.
 */
export function regexProblem(src: string | null | undefined): string | null {
  const s = String(src ?? "");
  // Saved formats are checked on every notification: memoise the verdict per source.
  const known = lruGet(verdicts, s);
  if (known !== undefined) return known;
  const v = regexVerdict(s);
  lruSet(verdicts, s, v, 256);
  return v;
}

/** Map-based LRU helpers (a Map keeps insertion order; re-insert on hit). */
function lruGet<V>(m: Map<string, V>, k: string): V | undefined {
  const v = m.get(k);
  if (v !== undefined) {
    m.delete(k);
    m.set(k, v);
  }
  return v;
}
function lruSet<V>(m: Map<string, V>, k: string, v: V, max: number) {
  m.delete(k);
  m.set(k, v);
  while (m.size > max) m.delete(m.keys().next().value!);
}
const verdicts = new Map<string, string | null>();

function regexVerdict(s: string): string | null {
  if (!s.trim()) return REGEX_PROBLEM.empty;
  if (s.length > NOTIFY_LIMITS.regex) return REGEX_PROBLEM.long;
  if (/\\[1-9]|\\k</.test(s)) return REGEX_PROBLEM.backref;
  if (/\(\?<[=!]/.test(s)) return REGEX_PROBLEM.lookbehind;
  // Allowlist first, so the verdict never depends on what this engine happens to accept.
  let tree: Alt;
  try {
    tree = parseRegex(s);
    new RegExp(s, "i");
  } catch {
    return REGEX_PROBLEM.invalid;
  }
  if (countUnbounded(tree) > MAX_UNBOUNDED) return REGEX_PROBLEM.unbounded;
  // Each distinct atom costs one pass over all 65 536 code units (~0.5 ms): cap them (R2).
  if (new Set(allLeaves(tree)).size > MAX_DISTINCT_ATOMS) return REGEX_PROBLEM.complex;
  return shapeProblem(tree);
}

/*
 * A strict ALLOWLIST parser for the regex subset admins may write (no `u` flag). Anything it does
 * not explicitly model throws (→ "Regex tidak valid"), whatever the runtime accepts: engines keep
 * adding syntax (inline modifiers `(?s:…)` / `(?i:…)` in V8 12.5+, Node 24, workerd and browsers
 * — security review #4 R5), and each unmodelled form so far was a ReDoS bypass. Supported:
 * - groups `(…)`, `(?:…)`, `(?<name>…)` (ASCII name), lookahead `(?=…)` / `(?!…)`;
 * - alternation `|`, anchors `^` `$`, word boundaries `\b` `\B` (never quantified);
 * - quantifiers `*` `+` `?` `{n}` `{n,}` `{n,m}`, each optionally lazy (`?`);
 * - `.`, classes `[…]` / `[^…]` (also `[]`, `[^]`) with ranges;
 * - escapes in REGEX_SYNTAX.escapes (+ `\b` = backspace inside a class), `\xHH`, `\uHHHH`,
 *   `\cA`–`\cZ`, and `\0` not followed by a digit;
 * - any other literal character except unescaped `{ } ] * + ?` outside a class.
 */
export const REGEX_SYNTAX = {
  groups: ["(", "(?:", "(?=", "(?!", "(?<name>"],
  /**
   * Two-character escapes allowed outside and inside a class: character classes, control
   * characters, `\0` (not followed by a digit) and every ASCII punctuation / space (identity).
   */
  escapes: `dDwWsStnvfr0 !"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`,
  /** Allowed only outside a class (zero-width). */
  assertions: ["b", "B"],
  quantifiers: ["*", "+", "?", "{2}", "{2,}", "{2,5}", "*?", "+?", "??", "{2,5}?"],
} as const;

type Quant = { min: number; max: number };
type Leaf = { kind: "leaf"; src: string; zero?: boolean };
type Group = { kind: "group"; alts: Alt; look: boolean };
type Item = { node: Leaf | Group; q: Quant };
type Alt = Item[][];

const ONE: Quant = { min: 1, max: 1 };
const isQuantified = (q: Quant) => q.min !== 1 || q.max !== 1;
const isVariable = (q: Quant) => q.min !== q.max;

const unsupported = () => new Error("unsupported regex syntax");

/** Length of the escape at `s[i] === "\\"`, or throws when it is not on the allowlist. */
function escapeLength(s: string, i: number, inClass: boolean): number {
  const e = s[i + 1] ?? "";
  if (e === "0") {
    if (/^\d$/.test(s[i + 2] ?? "")) throw unsupported(); // legacy octal (`\012`)
    return 2;
  }
  if (e && REGEX_SYNTAX.escapes.includes(e)) return 2;
  if (e === "b") return 2; // word boundary outside, backspace inside a class
  if (e === "B" && !inClass) return 2;
  if (e === "x" && /^[0-9a-f]{2}$/i.test(s.slice(i + 2, i + 4))) return 4;
  if (e === "u" && /^[0-9a-f]{4}$/i.test(s.slice(i + 2, i + 6))) return 6;
  if (e === "c" && /^[a-z]$/i.test(s[i + 2] ?? "")) return 3;
  throw unsupported(); // \p{…}, \k, \1, \c1, \x1, \u{…}, identity escapes of letters, …
}

/**
 * Whether `src` uses only the allowlisted syntax (parser only, independent of what the running
 * engine would accept). `regexProblem` runs it before compiling.
 */
export function regexSyntaxOk(src: string): boolean {
  try {
    parseRegex(src);
    return true;
  } catch {
    return false;
  }
}

function parseRegex(s: string): Alt {
  let i = 0;
  const parseAlt = (inGroup: boolean): Alt => {
    const alts: Alt = [[]];
    while (i < s.length) {
      const c = s[i]!;
      if (c === ")") {
        if (!inGroup) throw new Error("unbalanced");
        return alts;
      }
      if (c === "|") {
        alts.push([]);
        i++;
        continue;
      }
      let node: Leaf | Group;
      if (c === "(") {
        let look = false;
        if (s[i + 1] !== "?") i++;
        else if (s.startsWith("(?:", i)) i += 3;
        else if (s.startsWith("(?=", i) || s.startsWith("(?!", i)) {
          look = true;
          i += 3;
        } else {
          const name = /^\(\?<[A-Za-z_$][\w$]*>/.exec(s.slice(i));
          if (!name) throw unsupported(); // (?s:…), (?i:…), (?-i:…), (?<=…), (?#…), …
          i += name[0].length;
        }
        const inner = parseAlt(true);
        if (s[i] !== ")") throw new Error("unbalanced");
        i++;
        node = { kind: "group", alts: inner, look };
      } else if (c === "[") {
        // Without the `u` flag `[]` (matches nothing) and `[^]` (matches anything) are complete
        // classes: a `]` right after `[` / `[^` closes the class, it is not a literal.
        let j = i + 1;
        if (s[j] === "^") j++;
        while (j < s.length && s[j] !== "]") j += s[j] === "\\" ? escapeLength(s, j, true) : 1;
        if (j >= s.length) throw new Error("unterminated class");
        node = { kind: "leaf", src: s.slice(i, j + 1) };
        i = j + 1;
      } else if (c === "\\") {
        const len = escapeLength(s, i, false);
        const e = s[i + 1];
        node = { kind: "leaf", src: s.slice(i, i + len), zero: e === "b" || e === "B" };
        i += len;
      } else if ("{}]*+?".includes(c)) {
        throw unsupported(); // a lone quantifier or brace: write `\{`, `\]`, …
      } else {
        node = { kind: "leaf", src: c, zero: c === "^" || c === "$" };
        i++;
      }
      let q = ONE;
      const m = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})/.exec(s.slice(i));
      if (m) {
        if (node.kind === "leaf" && node.zero) throw unsupported(); // `^*`, `\b+`
        if (m[1] === "*") q = { min: 0, max: Infinity };
        else if (m[1] === "+") q = { min: 1, max: Infinity };
        else if (m[1] === "?") q = { min: 0, max: 1 };
        else {
          const min = Number(m[2]);
          q = { min, max: m[3] ? (m[4] ? Number(m[4]) : Infinity) : min };
          if (q.max < min) throw unsupported();
        }
        i += m[0].length;
        if (s[i] === "?") i++; // lazy modifier
      }
      alts[alts.length - 1]!.push({ node, q });
    }
    if (inGroup) throw new Error("unbalanced");
    return alts;
  };
  return parseAlt(false);
}

function countUnbounded(alts: Alt): number {
  let n = 0;
  for (const seq of alts)
    for (const it of seq) {
      if (it.q.max === Infinity) n++;
      if (it.node.kind === "group") n += countUnbounded(it.node.alts);
    }
  return n;
}

const hasAlternation = (alts: Alt): boolean =>
  alts.length > 1 ||
  alts.some((seq) => seq.some((it) => it.node.kind === "group" && hasAlternation(it.node.alts)));

/** Leaf sources (character-consuming atoms) anywhere inside. */
function leaves(alts: Alt, out: string[] = []): string[] {
  for (const seq of alts)
    for (const it of seq) {
      if (it.node.kind === "leaf") {
        if (!it.node.zero) out.push(it.node.src);
      } else if (!it.node.look) leaves(it.node.alts, out);
    }
  return out;
}

/** Every character-consuming leaf, also inside lookarounds. */
function allLeaves(alts: Alt, out: string[] = []): string[] {
  for (const seq of alts)
    for (const it of seq)
      if (it.node.kind === "group") allLeaves(it.node.alts, out);
      else if (!it.node.zero) out.push(it.node.src);
  return out;
}

/** Min / max characters an alternation consumes. */
function lengthOf(alts: Alt): Quant {
  let min = Infinity;
  let max = 0;
  for (const seq of alts) {
    let a = 0;
    let b = 0;
    for (const it of seq) {
      const inner: Quant =
        it.node.kind === "leaf"
          ? it.node.zero
            ? { min: 0, max: 0 }
            : ONE
          : it.node.look
            ? { min: 0, max: 0 }
            : lengthOf(it.node.alts);
      a += inner.min * it.q.min;
      b += inner.max * it.q.max;
    }
    min = Math.min(min, a);
    max = Math.max(max, b);
  }
  return { min: min === Infinity ? 0 : min, max };
}

/** Atoms a branch can start with (up to and including its first mandatory step). */
function firsts(seq: Item[]): string[] {
  const out: string[] = [];
  for (const st of steps(seq)) {
    out.push(...st.first);
    if (st.mandatory) break;
  }
  return out;
}

/** Any variable-length quantifier (`?`, `*`, `+`, `{n,m}`) inside? */
const hasVariable = (alts: Alt): boolean =>
  alts.some((seq) =>
    seq.some((it) => isVariable(it.q) || (it.node.kind === "group" && hasVariable(it.node.alts))),
  );

/**
 * One sequence step after flattening plain groups: its character-consuming atoms, whether it can
 * consume a varying number of characters (from a quantifier — an unquantified alternation of
 * fixed branches only varies by a constant) and whether it must consume at least one character.
 */
type Step = {
  leaves: string[];
  /** Atoms its first character can come from. */
  first: string[];
  variable: boolean;
  mandatory: boolean;
  span: number;
};

function steps(seq: Item[], out: Step[] = []): Step[] {
  for (const it of seq) {
    const n = it.node;
    if (n.kind === "leaf") {
      if (n.zero) continue;
      out.push({
        leaves: [n.src],
        first: [n.src],
        variable: isVariable(it.q),
        mandatory: it.q.min >= 1,
        span: it.q.max - it.q.min,
      });
    } else if (n.look) {
      continue; // zero width; its content is checked on its own
    } else if (!isQuantified(it.q) && n.alts.length === 1) {
      steps(n.alts[0]!, out); // plain (capture) group: part of this sequence
    } else {
      const len = lengthOf(n.alts);
      out.push({
        leaves: leaves(n.alts),
        first: n.alts.flatMap(firsts),
        variable: isVariable(it.q) || hasVariable(n.alts),
        mandatory: it.q.min >= 1 && len.min >= 1,
        span: len.max * it.q.max - len.min * it.q.min,
      });
    }
  }
  return out;
}

/**
 * Overlaps that only multiply the work by a small constant (an optional single character next to
 * an overlapping repetition, an alternation whose branches can start with the same character) are
 * allowed up to this many per pattern; together they bound backtracking by 2^n · text length.
 */
const MAX_AMBIGUITY = 3;

function shapeProblem(root: Alt): string | null {
  const sets = new Map<string, Uint32Array>();
  const setOf = (src: string) => {
    let v = sets.get(src);
    if (!v) sets.set(src, (v = charSet(src)));
    return v;
  };
  const pairs = new Map<string, boolean>();
  const pair = (x: string, y: string) => {
    const key = `${x}\u0000${y}`;
    let v = pairs.get(key);
    if (v === undefined) {
      const sx = setOf(x);
      const sy = setOf(y);
      // Backstop: an atom matching no single character (other than the literal `[]`) is not
      // modelled correctly (it may match several characters), so it overlaps everything.
      v =
        (x !== "[]" && isEmpty(sx)) ||
        (y !== "[]" && isEmpty(sy)) ||
        sx.some((w, k) => (w & sy[k]!) !== 0);
      pairs.set(key, v);
    }
    return v;
  };
  const overlap = (a: string[], b: string[]) => a.some((x) => b.some((y) => pair(x, y)));
  let ambiguity = 0;

  const walk = (alts: Alt): string | null => {
    for (let a = 0; a < alts.length; a++)
      for (let b = a + 1; b < alts.length; b++)
        if (overlap(firsts(alts[a]!), firsts(alts[b]!)) && ++ambiguity > MAX_AMBIGUITY)
          return REGEX_PROBLEM.overlap;
    for (const seq of alts) {
      for (const it of seq) {
        if (it.node.kind !== "group") continue;
        if (isQuantified(it.q)) {
          if (it.node.look || hasVariable(it.node.alts) || hasAlternation(it.node.alts))
            return REGEX_PROBLEM.nested;
        }
        const inner = walk(it.node.alts);
        if (inner) return inner;
      }
      const st = steps(seq);
      for (let a = 0; a < st.length; a++) {
        const x = st[a]!;
        if (!x.variable) continue;
        for (let b = a + 1; b < st.length; b++) {
          const y = st[b]!;
          // Where `x` stops is ambiguous only if `y` can start with a character `x` also eats.
          const hits = overlap(x.leaves, y.first);
          if (hits && y.variable) {
            if (x.span > 1 && y.span > 1) return REGEX_PROBLEM.overlap;
            if (++ambiguity > MAX_AMBIGUITY) return REGEX_PROBLEM.overlap;
          }
          if (!hits && y.mandatory) break; // a mandatory, disjoint step pins where `x` ends
        }
      }
    }
    return null;
  };
  return walk(root);
}

/** Every UTF-16 code unit once (built on first use). Non-`u` regexes match code units. */
let codeUnits: string | null = null;

/**
 * The exact set of code units a one-character atom matches with the `i` flag, as a 65 536-bit
 * set. Computed with one global pass over all code units, so it is exact for every atom (negated
 * classes, `[^]`, `[]`, non-Latin ranges, case folding) — security review #2 showed that comparing
 * on a fixed probe set misses characters only a negated class can match.
 */
const isEmpty = (bits: Uint32Array) => bits.every((w) => w === 0);

const charSets = new Map<string, Uint32Array>();
function charSet(src: string): Uint32Array {
  const hit = lruGet(charSets, src);
  if (hit) return hit;
  codeUnits ??= Array.from({ length: 0x10000 }, (_, k) => String.fromCharCode(k)).join("");
  const bits = new Uint32Array(0x10000 / 32);
  const re = new RegExp(src, "gi");
  for (let m = re.exec(codeUnits); m; m = re.exec(codeUnits)) {
    if (m[0].length === 0) re.lastIndex++;
    else bits[m.index >>> 5]! |= 1 << (m.index & 31);
  }
  lruSet(charSets, src, bits, 512);
  return bits;
}

/** Compiled regex (flag `i`) or null when it fails `regexProblem`. */
export function compileRegex(src: string | null | undefined): RegExp | null {
  if (regexProblem(src)) return null;
  return new RegExp(String(src), "i");
}

/* ---------------- formats ---------------- */

export type MatchMode = "contains" | "regex";
export const MATCH_MODES: readonly MatchMode[] = ["contains", "regex"];

export type NotifyFormat = {
  id?: string;
  name: string;
  /** Comma-separated substrings of the app package or app name (any); empty = any app. */
  app_match: string | null;
  title_match: string | null;
  text_match: string | null;
  match_mode: MatchMode;
  amount_regex: string;
  /** Comma-separated keywords; at least one must appear (empty = no requirement). */
  must_contain: string | null;
  /** Comma-separated keywords; any of them → ignored (e.g. outgoing money, OTP). */
  ignore_contains: string | null;
  /** Optional wallet: only invoices paid into this wallet are candidates. */
  account_id?: string | null;
  enabled: boolean;
  position?: number;
};

/** Default amount pattern: "Rp 1.250.000,00", "IDR1,250,000", "Rp. 50.000". */
export const DEFAULT_AMOUNT_REGEX = String.raw`(?:Rp\.?|IDR)\s?(?<amount>\d[\d.,]*)`;
const INCOMING = "masuk,diterima,menerima,terima,kredit,received";
const OUTGOING = "keluar,debit,berhasil dibayar,pembayaran ke,transfer ke,kirim ke,top up,OTP,kode";

/**
 * Editable examples for common Indonesian apps (not verified against real notifications — the
 * admin must check them with "Uji teks contoh" and adjust). Package names are best effort.
 */
export const NOTIFY_PRESETS: readonly (NotifyFormat & { key: string })[] = [
  ["bca", "BCA (contoh, sesuaikan)", "com.bca,bca"],
  ["mandiri", "Livin' by Mandiri (contoh, sesuaikan)", "id.bmri,livin,mandiri"],
  ["bri", "BRImo (contoh, sesuaikan)", "id.co.bri,brimo"],
  ["bni", "BNI / wondr (contoh, sesuaikan)", "bni,wondr"],
  ["dana", "DANA (contoh, sesuaikan)", "id.dana"],
  ["ovo", "OVO (contoh, sesuaikan)", "ovo.id,ovo"],
  ["gopay", "GoPay (contoh, sesuaikan)", "gopay,com.gojek"],
  ["shopeepay", "ShopeePay (contoh, sesuaikan)", "com.shopee,shopeepay"],
].map(([key, name, app]) => ({
  key: key!,
  name: name!,
  app_match: app!,
  title_match: null,
  text_match: null,
  match_mode: "contains" as const,
  amount_regex: DEFAULT_AMOUNT_REGEX,
  must_contain: INCOMING,
  ignore_contains: OUTGOING,
  account_id: null,
  enabled: true,
}));

/** The generic fallback (any app, Rupiah amount + incoming keyword), used when enabled. */
export const GENERIC_FORMAT: NotifyFormat = {
  name: "Generik (Rupiah)",
  app_match: null,
  title_match: null,
  text_match: null,
  match_mode: "contains",
  amount_regex: DEFAULT_AMOUNT_REGEX,
  must_contain: INCOMING,
  ignore_contains: OUTGOING,
  account_id: null,
  enabled: true,
};

/** "a, b ,c" → ["a","b","c"] (lower-case, empty dropped, ≤ 20 items). */
export function keywords(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

/** Validation problems of a format (Indonesian i18n keys). */
export function formatProblems(f: Partial<NotifyFormat>): string[] {
  const out: string[] = [];
  const name = String(f.name ?? "").trim();
  if (!name) out.push("Nama format wajib diisi");
  else if (name.length > NOTIFY_LIMITS.name) out.push("Nama format terlalu panjang");
  for (const k of ["app_match", "title_match", "text_match"] as const)
    if (String(f[k] ?? "").length > NOTIFY_LIMITS.match)
      out.push("Teks pencocokan terlalu panjang");
  for (const k of ["must_contain", "ignore_contains"] as const)
    if (String(f[k] ?? "").length > NOTIFY_LIMITS.keywords)
      out.push("Daftar kata kunci terlalu panjang");
  if (f.match_mode && !MATCH_MODES.includes(f.match_mode)) out.push("Mode pencocokan tidak valid");
  if (f.match_mode === "regex")
    for (const k of ["title_match", "text_match"] as const) {
      const v = String(f[k] ?? "").trim();
      if (v) {
        const p = regexProblem(v);
        if (p) out.push(p);
      }
    }
  const p = regexProblem(f.amount_regex);
  if (p) out.push(p);
  return [...new Set(out)];
}

/** Trimmed DB values of a valid format (empty strings → null). */
export function formatValues(f: NotifyFormat) {
  const opt = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };
  return {
    name: f.name.trim(),
    app_match: opt(f.app_match),
    title_match: opt(f.title_match),
    text_match: opt(f.text_match),
    match_mode: f.match_mode === "regex" ? ("regex" as const) : ("contains" as const),
    amount_regex: f.amount_regex.trim(),
    must_contain: opt(f.must_contain),
    ignore_contains: opt(f.ignore_contains),
    account_id: f.account_id || null,
    enabled: f.enabled !== false,
  };
}

/* ---------------- notifications ---------------- */

export type NotificationInput = {
  app: string;
  package: string;
  title: string;
  text: string;
};

/** MacroDroid leaves unresolved magic text such as "{not_text_big}" literally; drop it. */
const unresolved = (s: string) => /^\{[a-z_=]+\}$|^\[[a-z_=]+\]$/i.test(s.trim());

/** One clean single-spaced line, control characters removed, cut to `max`. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = Array.from(String(v), (c) => {
    const n = c.charCodeAt(0);
    return n < 32 || n === 127 ? " " : c;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return unresolved(s) ? "" : s.slice(0, max);
}

/**
 * Normalises a raw endpoint body. `text` = big text when it is longer (it usually contains the
 * whole message), else the normal text (+ sub text).
 */
export function normalizeNotification(body: Record<string, unknown>): NotificationInput {
  const text = cleanLine(body["text"], NOTIFY_LIMITS.text);
  const big = cleanLine(body["big_text"], NOTIFY_LIMITS.text);
  const sub = cleanLine(body["sub_text"], NOTIFY_LIMITS.title);
  const main = big.length > text.length ? big : text;
  return {
    app: cleanLine(body["app"], NOTIFY_LIMITS.app),
    package: cleanLine(body["package"], NOTIFY_LIMITS.app).toLowerCase(),
    title: cleanLine(body["title"], NOTIFY_LIMITS.title),
    text: sub && !main.includes(sub) ? `${main} ${sub}`.slice(0, NOTIFY_LIMITS.text) : main,
  };
}

/** The text every regex/keyword sees: title + text, truncated to MAX_SCAN_CHARS. */
export function scanText(n: Pick<NotificationInput, "title" | "text">): string {
  return `${n.title}\n${n.text}`.slice(0, MAX_SCAN_CHARS);
}

function textMatches(value: string, pattern: string | null, mode: MatchMode): boolean {
  const p = String(pattern ?? "").trim();
  if (!p) return true;
  const v = value.slice(0, MAX_SCAN_CHARS);
  if (mode === "regex") {
    const re = compileRegex(p);
    return !!re && re.test(v);
  }
  return v.toLowerCase().includes(p.toLowerCase());
}

/** `com.bca` matches the package `com.bca` or `com.bca.mobile` (whole dot segments only). */
export function packageMatches(entry: string, pkg: string): boolean {
  const e = entry.trim().toLowerCase();
  const p = pkg.trim().toLowerCase();
  return !!e && !!p && (p === e || p.startsWith(`${e}.`));
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * App filter. An entry with a dot is a package name (whole dot segments, see `packageMatches`);
 * an entry without a dot is a word of the app name or one segment of the package
 * (case-insensitive). Never a bare substring: "bca" does not match `com.abcapp`. Empty = any app.
 */
export function appMatches(f: Pick<NotifyFormat, "app_match">, n: NotificationInput): boolean {
  const list = keywords(f.app_match);
  if (!list.length) return true;
  const segs = n.package.toLowerCase().split(".");
  const appWords = words(n.app);
  return list.some((k) => {
    if (k.includes(".")) return packageMatches(k, n.package);
    const kw = words(k);
    if (!kw.length) return false;
    if (kw.length === 1 && segs.includes(kw[0]!)) return true;
    // multi-word entry ("livin mandiri") = consecutive words of the app name
    return appWords.some((_, i) => kw.every((w, j) => appWords[i + j] === w));
  });
}

/**
 * Whether a parsed notification may be booked by auto-confirm: only a saved, non-generic format
 * whose app list names a package (an entry with a dot) that equals the notifying package. App
 * names and the generic fallback can be posted by any app on the phone, so they always wait for
 * the admin.
 */
export function autoConfirmable(
  f: Pick<NotifyFormat, "app_match">,
  generic: boolean,
  n: Pick<NotificationInput, "package">,
): boolean {
  if (generic) return false;
  return keywords(f.app_match).some((k) => k.includes(".") && packageMatches(k, n.package));
}

/** Amount from the format's regex: named group `amount`, else the first group, else the match. */
export function extractAmount(regex: string, text: string): number | null {
  const re = compileRegex(regex);
  if (!re) return null;
  const m = re.exec(text.slice(0, MAX_SCAN_CHARS));
  if (!m) return null;
  const raw = m.groups?.["amount"] ?? m.slice(1).find((x) => x != null) ?? m[0];
  return parseRupiah(raw);
}

export type ParseResult =
  | {
      kind: "amount";
      amount: number;
      format: NotifyFormat;
      generic: boolean;
      /** May be booked by auto-confirm (see `autoConfirmable`). */
      trusted: boolean;
    }
  | { kind: "ignored"; reason: string; format: NotifyFormat | null }
  | { kind: "none"; reason: string };

export const PARSE_REASON = {
  noFormat: "Tidak ada format yang cocok",
  ignored: "Mengandung kata yang diabaikan",
  noKeyword: "Tidak ada kata kunci uang masuk",
  noAmount: "Nominal tidak ditemukan",
} as const;

/**
 * Applies the enabled formats in order (first whose app/title/text filters match wins), then the
 * generic fallback when `generic` is on. Keyword checks are case-insensitive substrings.
 */
export function parseNotification(
  formats: readonly NotifyFormat[],
  n: NotificationInput,
  opts: { generic?: boolean } = {},
): ParseResult {
  const text = scanText(n);
  const lower = text.toLowerCase();
  const list = formats.filter((f) => f.enabled !== false);
  const candidates: { f: NotifyFormat; generic: boolean }[] = list
    .filter(
      (f) =>
        appMatches(f, n) &&
        textMatches(n.title, f.title_match, f.match_mode) &&
        textMatches(n.text, f.text_match, f.match_mode),
    )
    .map((f) => ({ f, generic: false }));
  if (!candidates.length && opts.generic) candidates.push({ f: GENERIC_FORMAT, generic: true });
  const first = candidates[0];
  if (!first) return { kind: "none", reason: PARSE_REASON.noFormat };
  const { f, generic } = first;
  if (keywords(f.ignore_contains).some((k) => lower.includes(k)))
    return { kind: "ignored", reason: PARSE_REASON.ignored, format: f };
  const must = keywords(f.must_contain);
  if (must.length && !must.some((k) => lower.includes(k)))
    return { kind: "ignored", reason: PARSE_REASON.noKeyword, format: f };
  const amount = extractAmount(f.amount_regex, text);
  if (amount === null) return { kind: "ignored", reason: PARSE_REASON.noAmount, format: f };
  return { kind: "amount", amount, format: f, generic, trusted: autoConfirmable(f, generic, n) };
}

/**
 * What is stored of a notification: one line, ≤ NOTIFY_LIMITS.excerpt, numbers of 6+ digits
 * (account, card, phone or reference numbers — also when written in groups joined by `-`, `.`,
 * `,`, `/`, `_` or spaces, e.g. "0812-3456-7890", "0812/3456/7890", or in full-width digits)
 * masked except the last 3 digits. Kept readable: the amount right after Rp/IDR (≤ 12 digits,
 * anything glued after it is masked), a plausible bare amount in thousands grouping (≤ 9 digits,
 * no leading zero: "1.250.000", "1,250,000.00") and a date ("01/11/2026"). Security review #2 N6.
 */
export function minimiseText(n: Pick<NotificationInput, "title" | "text">): string {
  return `${n.title}${n.title && n.text ? " · " : ""}${n.text}`
    .normalize("NFKC") // full-width / styled digits → ASCII
    .replace(
      /((?:rp\.?|idr)\s?)?(\p{Nd}+(?:[-., /_]\p{Nd}+)*)/giu,
      (_, pre: string | undefined, run: string) => {
        if (!pre) return maskNumber(run);
        const amount = RP_AMOUNT.exec(run)?.[0] ?? "";
        return `${pre}${amount}${maskNumber(run.slice(amount.length))}`;
      },
    )
    .slice(0, NOTIFY_LIMITS.excerpt);
}

/** The amount after Rp/IDR: thousands grouping (≤ 4 groups) or ≤ 10 plain digits, + cents. */
const RP_AMOUNT =
  /^(?:(?:[1-9]\d{0,2}(?:([.,])\d{3}(?:\1\d{3}){0,2})?|0)|[1-9]\d{0,9})(?:[.,]\d{1,2})?(?!\d)/;
/** A bare number kept as an amount: thousands grouping, ≤ 9 integer digits, no leading zero. */
const BARE_AMOUNT =
  /^[1-9]\d{0,2}(?:\.\d{3}){1,2}(?:,\d{1,2})?$|^[1-9]\d{0,2}(?:,\d{3}){1,2}(?:\.\d{1,2})?$/;
const DATE = /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/;

/** A digit run (possibly with separators): kept when short, an amount or a date, else masked. */
function maskNumber(run: string): string {
  const lead = /^\D*/u.exec(run)![0];
  const body = run.slice(lead.length);
  const digits = body.replace(/\P{Nd}/gu, "");
  if (digits.length < 6 || BARE_AMOUNT.test(body) || DATE.test(body)) return run;
  return `${lead}${"•".repeat(Math.min(6, digits.length - 3))}${digits.slice(-3)}`;
}

/**
 * Whether a JSON text repeats a key inside one object (at any depth). `JSON.parse` silently keeps
 * the last duplicate, so a hand-written MacroDroid template with unescaped magic text could let a
 * sender-controlled remark inject `","text":"Rp 500.123 masuk` and override `text` while `package`
 * stays the genuine bank (security review #2 N4). Keys are compared after JSON unescaping.
 * Invalid JSON returns false here (JSON.parse reports it). Linear in the text length.
 */
export function hasDuplicateJsonKeys(text: string): boolean {
  const stack: (Set<string> | null)[] = []; // null = array
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (c === "[") {
      stack.push(null);
      expectKey = false;
    } else if (c === "}" || c === "]") {
      stack.pop();
      expectKey = false;
    } else if (c === ",") {
      expectKey = stack.at(-1) instanceof Set;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (expectKey && top) {
        let key: string;
        try {
          key = JSON.parse(text.slice(i, j + 1)) as string;
        } catch {
          return false;
        }
        if (top.has(key)) return true;
        top.add(key);
      }
      expectKey = false;
      i = j;
    }
  }
  return false;
}

/** Notification time from MacroDroid's `{not_timestamp}` (ms epoch) or an ISO string; else null. */
export function postedAt(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{10,14}$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** True when the notification time is within the accepted window around `now`. */
export function isFresh(posted: number, now: number): boolean {
  return posted >= now - SIGNAL_MAX_AGE_MS && posted <= now + SIGNAL_MAX_FUTURE_MS;
}

/* ---------------- unique codes & matching ---------------- */

/** A free code in 1..999 (random start, then linear probe), or null when all are taken. */
export function pickUniqueCode(used: Iterable<number>, rand: () => number = Math.random) {
  const taken = new Set([...used].map(Number));
  const span = UNIQUE_CODE_MAX - UNIQUE_CODE_MIN + 1;
  const start = Math.floor(Math.max(0, Math.min(0.999999, rand())) * span);
  for (let i = 0; i < span; i++) {
    const code = UNIQUE_CODE_MIN + ((start + i) % span);
    if (!taken.has(code)) return code;
  }
  return null;
}

export function isUniqueCode(v: unknown): v is number {
  return (
    Number.isInteger(v) && (v as number) >= UNIQUE_CODE_MIN && (v as number) <= UNIQUE_CODE_MAX
  );
}

/** Amount the customer transfers: remaining + unique code (code only while something is due). */
export function transferAmount(remaining: number, code: number | null | undefined): number {
  const r = Math.max(0, Number(remaining) || 0);
  if (r <= EPS) return 0;
  return Math.round((r + (isUniqueCode(code) ? code : 0)) * 100) / 100;
}

export type MatchCandidate = {
  id: string;
  total: number | string;
  paid: number | string;
  unique_code: number | null;
  created_at: string;
  account_id: string | null;
};

export type MatchResult =
  | { status: "matched"; invoiceId: string }
  | { status: "ambiguous"; invoiceIds: string[] }
  | { status: "unmatched" };

/**
 * Open invoices whose remaining + unique code equals `amount` exactly, created before the
 * notification (± clock skew), optionally only into `accountId`. One → matched, more → ambiguous.
 */
export function matchSignal(
  amount: number,
  invoices: readonly MatchCandidate[],
  o: { postedAt: number; accountId?: string | null },
): MatchResult {
  const hits = invoices.filter((inv) => {
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    if (remaining <= EPS) return false;
    if (o.accountId && inv.account_id !== o.accountId) return false;
    const created = Date.parse(inv.created_at);
    if (Number.isFinite(created) && created > o.postedAt + INVOICE_CLOCK_SKEW_MS) return false;
    return Math.abs(transferAmount(remaining, inv.unique_code) - amount) < EPS;
  });
  if (hits.length === 1) return { status: "matched", invoiceId: hits[0]!.id };
  if (hits.length > 1) return { status: "ambiguous", invoiceIds: hits.map((h) => h.id) };
  return { status: "unmatched" };
}

/**
 * Splits a received amount for an invoice: `pay` (≤ remaining) books the invoice payment, `extra`
 * is the unique code part booked as its own small income (only when it equals the invoice's code).
 */
export function splitSignalAmount(
  received: number,
  remaining: number,
  code: number | null | undefined,
): { pay: number; extra: number } {
  const r = Math.max(0, Number(remaining) || 0);
  const a = Math.max(0, Number(received) || 0);
  if (isUniqueCode(code) && Math.abs(a - (r + code)) < EPS) return { pay: r, extra: code };
  return { pay: Math.round(Math.min(a, r) * 100) / 100, extra: 0 };
}

/* ---------------- signals ---------------- */

export const SIGNAL_STATUSES = [
  "unmatched",
  "matched",
  "ambiguous",
  "confirmed",
  "ignored",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
/** Statuses an admin can still confirm or ignore. */
export const OPEN_SIGNAL_STATUSES: readonly SignalStatus[] = ["unmatched", "matched", "ambiguous"];

export const SIGNAL_STATUS_LABEL: Record<SignalStatus, string> = {
  unmatched: "Tidak cocok",
  matched: "Menunggu verifikasi",
  ambiguous: "Ambigu",
  confirmed: "Dikonfirmasi",
  ignored: "Diabaikan",
};

/** Payment reference of a booked signal (also used for crash recovery). */
export const signalReference = (id: string) => `signal:${id.slice(0, 8)}`;

export const CONFIRM_PROBLEM = {
  done: "Notifikasi ini sudah diproses",
  closed: "Invoice ini tidak bisa menerima pembayaran",
  held: "Invoice ditahan karena refund; klik Tagih ulang dulu",
  zero: "Jumlah harus lebih dari 0",
  over: "Pembayaran melebihi sisa tagihan",
} as const;

/**
 * Problem with confirming a signal for an invoice (i18n key) or null. `held` = the invoice is on
 * v25 refund hold (the customer was just refunded; nothing is booked until "Tagih ulang").
 */
export function confirmProblem(
  signal: { status: string; payment_id?: string | null },
  inv: { status: string; total: number | string; paid: number | string },
  pay: number,
  held = false,
): string | null {
  if (!OPEN_SIGNAL_STATUSES.includes(signal.status as SignalStatus) || signal.payment_id)
    return CONFIRM_PROBLEM.done;
  if (inv.status !== "unpaid" && inv.status !== "partial") return CONFIRM_PROBLEM.closed;
  if (held) return CONFIRM_PROBLEM.held;
  if (!(pay > 0)) return CONFIRM_PROBLEM.zero;
  if (pay > Number(inv.total) - Number(inv.paid) + EPS) return CONFIRM_PROBLEM.over;
  return null;
}

/**
 * Bookings of one invoice are serialised: only one signal per invoice may hold a claim
 * (`payment_signals_invoice_claim_idx`). A request that finds the invoice busy waits and retries
 * this many times, with a jittered, growing delay (`claimBackoffMs`).
 */
export const CLAIM_RETRIES = 8;
export function claimBackoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(1_000, 80 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + base * Math.max(0, Math.min(1, rand())) * 0.5);
}

/** A released unique code stays reserved this long before another invoice may get it. */
export const UNIQUE_CODE_COOLDOWN_MS = SIGNAL_MAX_AGE_MS;

/** Reason stored on matched signals that auto-confirm skipped or later superseded. */
export const SIGNAL_REASON = {
  untrusted: "Tidak dikonfirmasi otomatis: format tanpa nama paket aplikasi atau format generik",
  held: "Invoice ditahan karena refund; klik Tagih ulang dulu",
  superseded: "Invoice sudah lunas atau tidak terbuka lagi",
} as const;
