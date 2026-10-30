import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { hasTranslation } from "@/lib/i18n";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Literal arguments of `t("…")`, `translateNow("…")` and `translate("…", lang)`. */
function literalKeys(source: string): { key: string; line: number }[] {
  const re = /\b(?:t|translateNow|translate)\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*[,)]/g;
  return [...source.matchAll(re)].map((m) => ({
    key: m[1] === '"' ? (JSON.parse(`"${m[2]}"`) as string) : m[2]!.replace(/\\(.)/g, "$1"),
    line: source.slice(0, m.index).split("\n").length,
  }));
}

describe("literalKeys", () => {
  it("finds double- and single-quoted keys with escapes", () => {
    expect(
      literalKeys(
        `t("Simpan")\nconst a = translateNow('Dari berkas "');\ntranslate("a \\"b\\"", lang)`,
      ),
    ).toEqual([
      { key: "Simpan", line: 1 },
      { key: 'Dari berkas "', line: 2 },
      { key: 'a "b"', line: 3 },
    ]);
  });

  it("ignores calls that are not t() or that take a variable", () => {
    expect(literalKeys(`format("x"); t(label); alert("y")`)).toEqual([]);
  });
});

describe("DICT coverage", () => {
  it("has an English entry for every literal t() key in src", () => {
    const missing = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .flatMap((f) =>
        literalKeys(readFileSync(f, "utf8"))
          .filter(({ key }) => !hasTranslation(key))
          .map(({ key, line }) => `${relative(SRC, f)}:${line} ${JSON.stringify(key)}`),
      );
    expect(missing).toEqual([]);
  });
});
