#!/usr/bin/env node
/**
 * Dev-only: captures the README / landing screenshots into public/screenshots from a running app
 * filled with the fictional demo data (see docs/DEMO-DATA.md). Not a project dependency:
 *
 *   npm run db:up && npm run seed:demo -- --reset
 *   set -a; . ./.env.local; set +a; npx vite dev --port 8080   # in another terminal
 *   npm run screenshots
 *
 * Env: SCREENSHOT_URL (default http://localhost:8080), APP_USERNAME / APP_PASSWORD (read from
 * .env.local by the npm script), SCREENSHOT_ONLY=dashboard,landing to capture a subset.
 * Never point this at a deployment with real data: the images are committed to the repo.
 * (`npx playwright install chromium` once if the browser is missing.)
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public/screenshots");
const BASE = (process.env.SCREENSHOT_URL ?? "http://localhost:8080").replace(/\/$/, "");
const USER = process.env.APP_USERNAME ?? "demo";
const PASS = process.env.APP_PASSWORD ?? "demo-password-123";
const ONLY = (process.env.SCREENSHOT_ONLY ?? "").split(",").filter(Boolean);

/** Resolve a package from the project or from the `npx -p <pkg>` bin dir on PATH. */
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

const playwright = load("playwright");
if (!playwright) {
  console.error("playwright not found — run: npm run screenshots (uses npx -p playwright)");
  process.exit(1);
}
const { chromium } = playwright;
// Optional: palette-quantize PNGs (~3x smaller, visually lossless for flat UI). Skipped if absent.
const sharp = load("sharp");

if (
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) &&
  !process.argv.includes("--allow-remote")
) {
  console.error(`Refusing to capture ${BASE}: screenshots must come from the local demo stack.`);
  console.error("Pass --allow-remote only for another throwaway demo deployment.");
  process.exit(1);
}

/** Freeze the page for stable shots: no motion, no caret, no toasts or dev overlays. */
const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition: none !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}
[data-sonner-toaster], vite-error-overlay, #tsr-devtools, .tsqd-parent-container,
[data-tanstack-devtools], nextjs-portal { display: none !important; }
`;

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/**
 * `path` may be a function resolving the URL from a page. `prevMonth` steps the page's month
 * picker back once so early-month runs still show a full month. Landing shots come last because
 * the landing page embeds the other screenshots.
 */
const SHOTS = [
  { name: "dashboard", path: "/dashboard", charts: true, prevMonth: true },
  { name: "transactions", path: "/transactions", prevMonth: true },
  { name: "budgets", path: "/budgets" },
  { name: "reports", path: "/reports", charts: true },
  { name: "accounts-detail", path: firstAccount, charts: true, prevMonth: true },
  { name: "goals", path: "/goals" },
  { name: "gold", path: "/gold" },
  { name: "recurring", path: "/recurring" },
  { name: "settings", path: "/settings" },
  // v1.5: integrations, profile, members, Kantong (current month: pockets reset monthly).
  { name: "settings-integrations", path: "/settings", then: scrollToHeading("Integrasi") },
  { name: "settings-users", path: "/settings", then: scrollToHeading("Pengguna") },
  { name: "profile", path: "/profile" },
  {
    name: "accounts-pockets",
    path: accountNamed("GoPay"),
    charts: true,
    then: scrollToHeading("Kantong"),
  },
  { name: "transaction-pocket", path: "/transactions", then: openPocketSelect },
  {
    name: "dashboard-pockets",
    path: "/dashboard",
    then: scrollToHeading("Kantong perlu perhatian"),
  },
  { name: "dashboard-mobile", path: "/dashboard", mobile: true, charts: true, prevMonth: true },
  { name: "transactions-mobile", path: "/transactions", mobile: true, prevMonth: true },
  { name: "telegram-bot", path: "/__telegram-mock", mock: true, mobile: true },
  { name: "landing", path: "/", public: true, fullPage: true },
  { name: "landing-mobile", path: "/", public: true, mobile: true },
].filter((s) => !ONLY.length || ONLY.includes(s.name));

async function firstAccount(page) {
  await page.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
  const link = page.locator('a[href^="/accounts/"]').first();
  await link.waitFor({ timeout: 20_000 });
  return link.getAttribute("href");
}

/** Wallet detail URL of the account card whose text contains `name`. */
function accountNamed(name) {
  return async (page) => {
    await page.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
    const link = page.locator('a[href^="/accounts/"]', { hasText: name }).first();
    await link.waitFor({ timeout: 20_000 });
    return link.getAttribute("href");
  };
}

/** Scrolls the card with an exact `<h2>` text near the top, below the sticky header. */
function scrollToHeading(text) {
  return async (page) => {
    const h = page.locator("main h2", { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();
    await h.waitFor({ timeout: 20_000 });
    await h.evaluate((el) => {
      const card = el.closest("[class*='rounded']") ?? el;
      window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 24);
    });
    await page.waitForTimeout(400);
  };
}

/** New expense on GoPay with the Kantong select opened. */
async function openPocketSelect(page) {
  await page.getByRole("button", { name: "Catat" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#account_id").click();
  await page.getByRole("option", { name: "GoPay (IDR)", exact: true }).click();
  await dialog.locator("#amount").fill("24000");
  await dialog.locator("#category_id").click();
  await page.getByRole("option", { name: "Transportasi", exact: true }).click();
  await dialog.locator("#pocket_id").click();
  await page.getByRole("option", { name: "Transport", exact: true }).waitFor();
  await page.waitForTimeout(400);
}

async function newContext(browser, { mobile, theme }) {
  const ctx = await browser.newContext({
    ...(mobile ? MOBILE : DESKTOP),
    colorScheme: theme,
    reducedMotion: "reduce",
    locale: "id-ID",
    timezoneId: process.env.APP_TIMEZONE ?? "Asia/Jakarta",
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("dk-theme", t);
      localStorage.setItem("dk-lang", "id");
      localStorage.removeItem("dk-privacy");
    } catch {
      // ignore
    }
  }, theme);
  return ctx;
}

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", USER);
  await page.fill("#password", PASS);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  if (await page.locator('input[name="code"]').count()) {
    throw new Error("This account has TOTP enabled; unset APP_TOTP_SECRET for screenshots.");
  }
  if (!/\/dashboard/.test(page.url())) throw new Error(`Login failed (still at ${page.url()})`);
  await page.close();
}

async function settle(page, { charts, prevMonth }) {
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForLoadState("networkidle");
  if (prevMonth) {
    await page.locator('main button[aria-label="Sebelumnya"]').first().click();
    await page.waitForLoadState("networkidle");
  }
  // Skeletons gone (Skeleton uses animate-pulse) and fonts ready.
  await page
    .waitForFunction(() => !document.querySelector("main .animate-pulse"), null, {
      timeout: 30_000,
    })
    .catch(() => console.warn("  ! skeletons still visible"));
  if (charts)
    await page
      .waitForSelector(".recharts-surface", { timeout: 30_000 })
      .catch(() => console.warn("  ! no chart rendered"));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let lazy chart chunks and ResizeObservers finish their last paint.
  await page.waitForTimeout(1200);
  await page.mouse.move(0, 0);
}

/** Lazy images below the fold only load when scrolled into view: walk the page once. */
async function loadLazy(page) {
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll("img[loading=lazy]")) img.loading = "eager";
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      [...document.images].map((i) =>
        i.complete
          ? null
          : new Promise(
              (r) => i.addEventListener("load", r, { once: true }) || setTimeout(r, 4000),
            ),
      ),
    );
  });
}

function optimize(png) {
  return sharp(png).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer();
}

async function capture(browser, theme) {
  const ctxs = {};
  const get = async (shot) => {
    const key = `${shot.mobile ? "m" : "d"}${shot.public || shot.mock ? "p" : "a"}`;
    if (!ctxs[key]) {
      ctxs[key] = await newContext(browser, { mobile: shot.mobile, theme });
      if (!(shot.public || shot.mock)) await login(ctxs[key]);
    }
    return ctxs[key];
  };
  for (const shot of SHOTS) {
    const ctx = await get(shot);
    const page = await ctx.newPage();
    if (shot.mock) {
      // Serve the static mock from the app origin so /logo.svg resolves.
      await page.route(`${BASE}/__telegram-mock*`, (r) =>
        r.fulfill({ path: join(root, "scripts/telegram-mock.html"), contentType: "text/html" }),
      );
      await page.goto(`${BASE}/__telegram-mock?theme=${theme}`, { waitUntil: "networkidle" });
    } else {
      const path = typeof shot.path === "function" ? await shot.path(page) : shot.path;
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    }
    await settle(page, shot);
    if (shot.then) await shot.then(page);
    if (shot.fullPage) {
      await loadLazy(page);
      await page.waitForTimeout(500);
    }
    const file = join(out, `${shot.name}${theme === "dark" ? "-dark" : ""}.png`);
    const png = await page.screenshot({
      fullPage: !!shot.fullPage,
      animations: "disabled",
      caret: "hide",
    });
    writeFileSync(file, sharp ? await optimize(png) : png);
    console.log(`  ${file.replace(root + "/", "")}  ${Math.round(statSync(file).size / 1024)} KB`);
    await page.close();
  }
  for (const c of Object.values(ctxs)) await c.close();
}

mkdirSync(out, { recursive: true });
if (!sharp) console.warn("sharp not found: writing unoptimized PNGs (npx -p sharp to enable).");
const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    console.log(`${theme}:`);
    await capture(browser, theme);
  }
} finally {
  await browser.close();
}
