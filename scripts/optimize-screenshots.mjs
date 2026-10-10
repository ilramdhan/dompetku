#!/usr/bin/env node
/**
 * Dev-only: builds responsive WebP/AVIF variants of the landing screenshots from the PNGs in
 * public/screenshots (PNGs stay: the README uses them). Not a project dependency — run with:
 *
 *   npx -p sharp node scripts/optimize-screenshots.mjs
 *
 * Output: `<name>-<width>.webp` / `.avif` for each width in WIDTHS (never upscaled).
 * Keep WIDTHS in sync with SHOT_WIDTHS in src/lib/landing.ts.
 */
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public/screenshots");
const paths = [
  join(root, "node_modules"),
  ...(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((p) => resolve(p, "..")),
];
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths }));

const WIDTHS = [480, 960, 1440];
// Only the screenshots <Screenshot> renders on the landing (keep binary bloat minimal).
// Add a name here when the landing starts using another one.
const NAMES = ["dashboard", "dashboard-mobile", "reports", "telegram-bot"];
const files = NAMES.flatMap((n) => [`${n}.png`, `${n}-dark.png`]);
for (const f of files) {
  const base = f.replace(/\.png$/, "");
  const { width } = await sharp(join(dir, f)).metadata();
  const widths = WIDTHS.filter((w) => w <= width);
  if (!widths.length) widths.push(width);
  for (const w of widths) {
    const img = () => sharp(join(dir, f)).resize({ width: w, withoutEnlargement: true });
    await img()
      .webp({ quality: 80 })
      .toFile(join(dir, `${base}-${w}.webp`));
    await img()
      .avif({ quality: 55 })
      .toFile(join(dir, `${base}-${w}.avif`));
  }
  console.log(base, widths.join("/"));
}
