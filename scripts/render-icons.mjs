#!/usr/bin/env node
/**
 * Dev-only: renders the PNG icons (favicon, apple-touch, PWA, maskable) from public/logo.svg,
 * plus the og-image, README banner and "what's new" cards from the HTML templates in
 * scripts/brand-cards.mjs, with a headless Chromium. Not a project dependency — run with:
 *
 *   npx -p playwright -p sharp node scripts/render-icons.mjs [og-image banner whats-new …]
 *
 * Optional args only render outputs whose path contains one of them. *
 * (`npx playwright install chromium` once if the browser is missing.)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bannerHtml,
  ogHtml,
  whatsNewV15Html,
  whatsNewV16Html,
  whatsNewV17Html,
} from "./brand-cards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Resolve a package from the project or from the `npx -p …` bin dir on PATH. */
function load(name) {
  const bases = [join(root, "package.json")];
  for (const p of (process.env.PATH ?? "").split(delimiter)) {
    if (p.endsWith(join("node_modules", ".bin"))) bases.push(join(p, "..", "x.js"));
  }
  for (const base of bases) {
    try {
      return createRequire(base)(name);
    } catch {
      // try next
    }
  }
  return null;
}

const svg = readFileSync(join(root, "public/logo.svg"), "utf8");
const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const font = (f) =>
  `data:font/woff2;base64,${readFileSync(join(root, "public/fonts", f)).toString("base64")}`;
const GREEN = "#1d3b2f";

/** Logo with transparent rounded corners. */
const tile = (size) => ({
  w: size,
  h: size,
  html: `<img src="${svgData}" width="${size}" height="${size}" style="display:block">`,
});

/** Full-bleed square (no transparency) with the mark inside the maskable safe zone. */
const square = (size, scale) => ({
  w: size,
  h: size,
  opaque: true,
  html: `<div style="width:${size}px;height:${size}px;background:${GREEN};display:grid;place-items:center">
    <img src="${svgData}" width="${Math.round(size * scale)}" style="display:block"></div>`,
});

/** Social card and README banner: HTML templates with a feature-card collage. */
const og = { w: 1200, h: 630, opaque: true, optimize: true, html: ogHtml({ logo: svgData, font }) };
const banner = {
  w: 1600,
  h: 500,
  opaque: true,
  optimize: true,
  html: bannerHtml({ logo: svgData, font }),
};

/** "What's new" portrait cards (ID + EN) for chats, README and release notes. */
const whatsNew = (lang, card = whatsNewV15Html) => ({
  w: 1200,
  h: 1500,
  opaque: true,
  optimize: true,
  html: card({ logo: svgData, font, lang }),
});

const targets = {
  "public/favicon.png": tile(64),
  "public/icons/favicon-32.png": tile(32),
  "public/icons/favicon-48.png": tile(48),
  // iOS masks the corners itself, so the apple icon is a full-bleed square.
  "public/icons/apple-touch-icon.png": square(180, 1),
  "public/icons/icon-192.png": tile(192),
  "public/icons/icon-512.png": tile(512),
  // Maskable: mark kept inside the central 80% safe zone.
  "public/icons/icon-maskable-512.png": square(512, 0.72),
  "public/icons/og-image.png": og,
  "src/assets/app-icon.png": tile(1024),
  "docs/assets/banner.png": banner,
  "docs/assets/whats-new-v1.5-id.png": whatsNew("id"),
  "docs/assets/whats-new-v1.5-en.png": whatsNew("en"),
  "docs/assets/whats-new-v1.6-id.png": whatsNew("id", whatsNewV16Html),
  "docs/assets/whats-new-v1.6-en.png": whatsNew("en", whatsNewV16Html),
  "docs/assets/whats-new-v1.7-id.png": whatsNew("id", whatsNewV17Html),
  "docs/assets/whats-new-v1.7-en.png": whatsNew("en", whatsNewV17Html),
};

const playwright = load("playwright");
if (!playwright) {
  console.error("playwright not found — run: npx -p playwright node scripts/render-icons.mjs");
  process.exit(1);
}
// Optional: palette-quantize the large cards (og-image, banner) so they stay small.
const sharp = load("sharp");
if (!sharp) console.warn("sharp not found: og-image/banner unoptimized (add -p sharp).");

// Optional filter: `node scripts/render-icons.mjs og-image banner` renders only matching outputs.
const only = process.argv.slice(2);
const { chromium } = playwright;
const browser = await chromium.launch();
for (const [out, t] of Object.entries(targets)) {
  if (only.length && !only.some((o) => out.includes(o))) continue;
  const page = await browser.newPage({ viewport: { width: t.w, height: t.h } });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${t.html}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  let png = await page.screenshot({ omitBackground: !t.opaque });
  if (t.optimize && sharp) {
    png = await sharp(png)
      .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
      .toBuffer();
  }
  mkdirSync(dirname(join(root, out)), { recursive: true });
  writeFileSync(join(root, out), png);
  console.log("wrote", out);
  await page.close();
}
await browser.close();
