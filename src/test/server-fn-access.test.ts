import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { MIDDLEWARE_FOR, SERVER_FN_ACCESS } from "@/lib/server-fn-access";

const LIB = join(__dirname, "..", "lib");
const SRC = join(__dirname, "..");

/** name → first middleware (or null) for every `export const X = createServerFn(...)`. */
function serverFns(source: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const re = /export const (\w+) = createServerFn\(/g;
  const starts = [...source.matchAll(re)];
  starts.forEach((m, i) => {
    const body = source.slice(m.index, starts[i + 1]?.index ?? source.length);
    const handler = body.indexOf(".handler(");
    const head = handler >= 0 ? body.slice(0, handler) : body;
    const mw = /\.middleware\(\[\s*(\w+)/.exec(head);
    out.set(m[1]!, mw ? mw[1]! : null);
  });
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("server fn access classification (v18 RBAC)", () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".functions.ts"));

  it("classifies every server fn with the matching middleware", () => {
    const problems: string[] = [];
    for (const f of files) {
      const fns = serverFns(readFileSync(join(LIB, f), "utf8"));
      const cls = SERVER_FN_ACCESS[f] ?? {};
      for (const [name, mw] of fns) {
        const access = cls[name];
        if (!access) problems.push(`${f}: ${name} is not classified in server-fn-access.ts`);
        else if (MIDDLEWARE_FOR[access] !== mw)
          problems.push(`${f}: ${name} is "${access}" but uses ${mw ?? "no middleware"}`);
      }
      for (const name of Object.keys(cls))
        if (!fns.has(name)) problems.push(`${f}: ${name} is classified but does not exist`);
    }
    for (const f of Object.keys(SERVER_FN_ACCESS))
      if (!files.includes(f)) problems.push(`${f} is classified but the file does not exist`);
    expect(problems).toEqual([]);
  });

  it("only defines server fns in *.functions.ts modules", () => {
    const stray = walk(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".functions.ts") && !p.includes("/test/"))
      .filter((p) => /export const \w+ = createServerFn\(/.test(readFileSync(p, "utf8")));
    expect(stray).toEqual([]);
  });

  it("member fns consult the RBAC scope in their handler", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(LIB, f), "utf8");
      const cls = SERVER_FN_ACCESS[f] ?? {};
      const starts = [...src.matchAll(/export const (\w+) = createServerFn\(/g)];
      starts.forEach((m, i) => {
        if (cls[m[1]!] !== "member") return;
        const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
        // getFxRate returns a public exchange rate only.
        if (m[1] === "getFxRate") return;
        if (!/rbac\.server|accountScope|assertWallet|assertTx|assertReceipt/.test(body))
          problems.push(`${f}: ${m[1]} is member-accessible but never checks RBAC`);
      });
    }
    expect(problems).toEqual([]);
  });
});
