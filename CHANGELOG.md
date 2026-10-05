# Changelog

All notable changes to Dompetku are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/) from **v1.0.0** on.

Starting with v1.0.0, versioned entries (`## [x.y.z]`) are generated automatically by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org) and inserted directly below this header — please don't edit them by hand; see [`docs/RELEASING.md`](docs/RELEASING.md). The `[Unreleased]` section and the dated entries below it were written manually before numbered releases existed and are grouped by the pull request that introduced them; everything in them is part of v1.0.0.

> [!NOTE]
> When an entry mentions a **schema section** (`v2`…`v13`), self-hosters must run that section of [`supabase/schema.sql`](supabase/schema.sql) on their Supabase project. Every section is safe to run more than once, and the app keeps working (with the feature disabled) until you do.

## [1.4.0](https://github.com/ilramdhan/dompetku/compare/v1.3.0...v1.4.0) (2026-10-05)


### Features

* **bot:** guard AI token usage with an amount gate, length cap and daily quota ([#17](https://github.com/ilramdhan/dompetku/issues/17)) ([85e86dc](https://github.com/ilramdhan/dompetku/commit/85e86dc4d04cf060d0e048cf00fa5d60be55a3d3))


### Documentation

* add accessibility statement ([#16](https://github.com/ilramdhan/dompetku/issues/16)) ([b5b9fbe](https://github.com/ilramdhan/dompetku/commit/b5b9fbefcd4f1cd5e8ea7cb76faa829c0eff104f))
* point repository links at ilramdhan/dompetku ([#18](https://github.com/ilramdhan/dompetku/issues/18)) ([a937710](https://github.com/ilramdhan/dompetku/commit/a937710bb16528c3b5731cb0069c73dcf046de41))

## [1.3.0](https://github.com/ilramdhan/dompetku/compare/v1.2.0...v1.3.0) (2026-10-04)


### Features

* **dashboard:** align stat cards and add share-of-income ratio widget ([dce1664](https://github.com/ilramdhan/dompetku/commit/dce166409859a40005c4ce7d30a943d0ab63bf0a))
* **lists:** paginate debts, goals, subscriptions, recurring and reminders ([194e876](https://github.com/ilramdhan/dompetku/commit/194e876b8e0dbdfffd8a7b135a3ee9caa505f59a))
* sticky mobile nav, list pagination, back-to-top and dashboard income-ratio widget ([b85e83b](https://github.com/ilramdhan/dompetku/commit/b85e83b4d1bbe1aca8fdce8c48675e81379a4740))


### Bug Fixes

* **shell:** pin mobile nav while scrolling, add app-wide back-to-top and smooth scroll ([8061e16](https://github.com/ilramdhan/dompetku/commit/8061e160269a32a3437000e8a3a71aa11969451c))


### Documentation

* add CLAUDE.md and record scroll, pagination and ratio rules ([182f8a3](https://github.com/ilramdhan/dompetku/commit/182f8a3c2aa9779d7119859594e8a17a182adfbb))

## [1.2.0](https://github.com/ilramdhan/dompetku/compare/v1.1.0...v1.2.0) (2026-10-04)


### Features

* **demo:** daily demo reset workflow and safer, fuller seed reset ([3837701](https://github.com/ilramdhan/dompetku/commit/383770184c3abdee2ef0f6a3a3514ada384b187f))
* **demo:** DEMO_MODE server guards, row caps, write rate limit and PUBLIC_DEMO_URL ([9eee011](https://github.com/ilramdhan/dompetku/commit/9eee011c04ce8c065231c4b0ec03c46c245bd44c))
* **demo:** one-click demo login, in-app banner, disabled controls and Coba demo links ([f093107](https://github.com/ilramdhan/dompetku/commit/f0931072cc2f0504e4191ec0d7ebe85ac67d6b1a))
* **demo:** public demo mode with one-click login, server guardrails, daily reset and Coba demo links ([4d42c33](https://github.com/ilramdhan/dompetku/commit/4d42c33d62487bbee5d521b6dbf6aca1e6190dc3))


### Documentation

* **demo:** public demo guide, env vars, README live demo link and security note ([3138ec9](https://github.com/ilramdhan/dompetku/commit/3138ec9150e26a96faab5536af0a93d83a473ed8))

## [1.1.0](https://github.com/ilramdhan/dompetku/compare/v1.0.0...v1.1.0) (2026-10-04)


### Features

* **app-shell:** show app version under sidebar and in the icon rail ([44c8140](https://github.com/ilramdhan/dompetku/commit/44c8140c718994f175e4ef9aae356183e7cc4a16))
* **landing:** sticky header, logo marquee, back-to-top and scoped smooth scroll ([e9bafa8](https://github.com/ilramdhan/dompetku/commit/e9bafa81813b4066b3eed72be213536e146087f2))
* **landing:** sticky nav, tech-icon marquee, back-to-top, legal pages & app version badge with update check ([c23d0da](https://github.com/ilramdhan/dompetku/commit/c23d0daa6cc6064f3cb8ff1a8ba2742136d33285))
* **legal:** add public /privacy and /terms pages ([4a8d6c5](https://github.com/ilramdhan/dompetku/commit/4a8d6c551da4f514d3364b8e3d45e660bc902eb5))
* **settings:** add About card with version, commit, build date and links ([1bbf905](https://github.com/ilramdhan/dompetku/commit/1bbf9055c7e4ac3095e55df03a922b489dbf85da))
* **version:** inject app version/commit at build and add VersionBadge ([a1f8504](https://github.com/ilramdhan/dompetku/commit/a1f85041bac3fa2801044a612877ebe7ec2014fe))


### Bug Fixes

* **root:** suppress expected html class hydration warning from the pre-paint theme script ([3c6a381](https://github.com/ilramdhan/dompetku/commit/3c6a3811553b6785535fa0f823a2ebe82b58484a))


### Documentation

* describe app version badge and update check ([832cc0d](https://github.com/ilramdhan/dompetku/commit/832cc0d8e2ea44ee99fd108acefaa6c19713edf7))
* mention legal pages and credit Simple Icons ([10fad5e](https://github.com/ilramdhan/dompetku/commit/10fad5eeb4eda196462ce3b0a2db34882fe7b4c6))
* **screenshots:** regenerate with sticky header, tech icons, legal links and version badge ([e0a3af2](https://github.com/ilramdhan/dompetku/commit/e0a3af2105fbb13d54bb0206e0d3d6b501282663))

## 1.0.0 (2026-10-04)


### Features

* **brand:** new Dompetku wallet logo, icons and og-image ([980cd37](https://github.com/ilramdhan/fintrack/commit/980cd37a6a4a4e98609a8865cbbae6c0a035eccd))
* landing page, new logo & dynamic app settings (v14), release-please, demo data & screenshots ([237fc98](https://github.com/ilramdhan/fintrack/commit/237fc98e1bf147989a4ecd6804589ba2418001d6))
* **landing:** public bento landing page at / ([bccc77d](https://github.com/ilramdhan/fintrack/commit/bccc77d10eb757ca0fa7f81f99d0053d2a741e78))
* **settings:** dynamic app settings (schema v14) ([2ed8f40](https://github.com/ilramdhan/fintrack/commit/2ed8f40f1ae57df7ef0bf8aad2c410fbbbe7c199))


### Documentation

* **demo:** read the local secret key from supabase status instead of inlining it ([ea227ff](https://github.com/ilramdhan/fintrack/commit/ea227ff7bfa4cdc2143c5b819894a1338c66526e))
* screenshot gallery in README and regenerating-screenshots guide ([8919fd3](https://github.com/ilramdhan/fintrack/commit/8919fd35aed02c27c9cb414fe68ebdf1ed10b84d))
* **screenshots:** add light/dark app, landing and bot screenshots from demo data ([7f2485c](https://github.com/ilramdhan/fintrack/commit/7f2485c3782418818f155764be01353bb095975a))

## [Unreleased]

### Added

- Open-source project files: MIT `LICENSE`, contributing guide, code of conduct, security policy, support guide, issue forms, English pull request template, Dependabot and CODEOWNERS.
- Repository metadata (`license`, `repository`, `homepage`, `bugs`) in `package.json`.

## 2026-10-04 — Roadmap 1–14 and privacy mode ([#4](https://github.com/ilramdhan/fintrack/pull/4))

### Added

- **Privacy mode**: eye toggle in the app shell (also `Shift+H`) masks every amount, balance, chart and gold weight on the current device; set before first paint so nothing flashes.
- **Two-step login (TOTP)** with optional `APP_TOTP_SECRET`, a signed 5-minute challenge and a Settings card to check status and enroll.
- **Recurring transactions** (schema `v10`): salary, rent and routine transfers posted automatically, plus a page with post-now and pause/resume, and recurring reminders.
- **Budget rollover and instant 80%/100% alerts** (schema `v11`) on the web (toast) and in Telegram bot replies, deduplicated per month.
- **Split transactions** (schema `v12`): split one receipt across several categories, with OCR item grouping.
- **Multiple receipt photos** (up to 5 per transaction, schema `v12`) with thumbnails and a gallery viewer; search now matches receipt item names.
- **Account detail page** (schema `v13`): monthly per-account report, balance chart and bank-statement reconciliation.
- **Savings goal projection**: monthly/weekly amount needed, status and ETA.
- **Backup and restore**: scheduled backup endpoint for n8n and restore from a JSON file.
- **Error monitoring**: structured JSON error logs with optional Sentry (`SENTRY_DSN`).
- Report aggregation in Postgres functions (schema `v9`) with an identical JavaScript fallback.
- Typed Supabase client (`src/lib/database.types.ts`).
- GitHub Actions CI (lint, typecheck, test, build) and a pull request template.

### Changed

- Fonts are self-hosted instead of loaded from Google Fonts.
- Charts (Recharts) are lazy-loaded, and routes show skeletons while loading.
- Code formatted with Prettier; remaining ESLint errors fixed.

### Fixed

- Backup/restore now includes recurring transactions, budget alerts and reconciliations, and skips the generated `items_search` column.
- Deleting a transaction or using the bot's `/undo` keeps receipt photos still used by other (split) transactions.

## 2026-10-04 — Mobile polish and goals as transfers ([#3](https://github.com/ilramdhan/fintrack/pull/3))

### Added

- Savings goal deposits and withdrawals are recorded as transfers between accounts (schema `v8`).

### Fixed

- Goal transfers use the source account's currency.
- Dashboard cards, subscription rows and other pages no longer overflow on narrow screens; gold records use stacked cards on mobile and a table on desktop; dialogs are rounded at every width.

## 2026-10-04 — Performance, responsiveness and security ([#2](https://github.com/ilramdhan/fintrack/pull/2))

### Added

- Baseline security headers on all responses.
- Login throttling after repeated failed attempts.
- Icon-rail sidebar on medium screens, compact header on short landscape screens, and a menu for secondary transaction actions on smaller screens.

### Changed

- Fewer sequential Supabase round trips on the dashboard; the session check is cached client-side between navigations.
- Vercel functions run in Singapore (`sin1`) to sit next to Supabase.
- Dropped an unused font weight.

### Fixed

- Aggregate queries page past PostgREST's 1000-row limit.
- Money values, cards and charts stay readable on narrow and short screens.
- OCR shows the AI provider's error reason to the user.
- n8n Telegram Trigger no longer drops inline-button callbacks.

## 2026-10-03 — Telegram bot v2 ([#1](https://github.com/ilramdhan/fintrack/pull/1))

### Added

- **Telegram bot v2**: a single `/api/public/n8n/bot` endpoint, preview with ✅/❌ buttons before saving, a zero-token quick parser for chat messages, reports and `/undo`; drafts are idempotent (schema `v7`).

### Security

- The bot fails closed when `BOT_ALLOWED_CHAT_IDS` is empty, drafts are scoped to the chat, `/undo` only removes bot-saved transactions, image MIME types are restricted and request bodies are size-capped.

### Fixed

- Quick-parse amounts and accounts, impossible dates rejected, deterministic account/category name matching, and bot reports page through all rows.

## 2026-10-01 – 2026-10-03 — Initial version

The first version was built with [Lovable](https://lovable.dev) on a TanStack Start template. It included:

- Income, expenses, transfers, debts/instalments (including pay-later), subscriptions in IDR/USD with tax, budgets and savings goals.
- Multiple payment accounts with transfer/top-up/monthly admin fees (schema `v4`).
- Receipt photo OCR and CSV import (schema `v2`).
- Activity log, gold savings with world/Antam prices, and receivables (schemas `v3`, `v5`, `v6`).
- Dashboard, reports, monthly reminders, n8n automation endpoints, single-user login from environment variables, ID/EN language switch, dark mode and an installable PWA manifest.

[Unreleased]: https://github.com/ilramdhan/fintrack/compare/814bdd3...HEAD
