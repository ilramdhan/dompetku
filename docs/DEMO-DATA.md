# Demo data (local throwaway database)

Run Dompetku locally against a disposable Supabase stack filled with realistic, **fully fictional**
Indonesian personal-finance data. Use it to try the app, develop features, or take reproducible
screenshots, without touching a real database.

## Requirements

- Docker (running)
- Node.js 22+ and `npm install` done in the repo
- No Supabase CLI install needed: the scripts use `npx supabase@2` (downloads on first run)

## Quick start

```bash
npm run db:up          # start local Supabase (Postgres + PostgREST + Storage + Studio) and apply supabase/schema.sql
# create .env.local (see below)
npm run seed:demo -- --reset          # wipe app data and insert demo data
set -a; . ./.env.local; set +a; npx vite dev --port 8080
```

Open <http://localhost:8080> and sign in with **demo** / **demo-password-123**.

Stop everything with `npm run db:down` (data is discarded).

### `.env.local`

`.env.local` is git-ignored (`*.local`). The Supabase values below are the **public default keys of
the local Supabase CLI stack** — they only work against `127.0.0.1` and are safe to share. Never
use them, or these login values, for a real deployment.

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
# local-only secret key printed by `npx supabase@2 status` ("Secret key", starts with sb_secret_)
SUPABASE_SERVICE_ROLE_KEY=<LOCAL_SECRET_KEY_FROM_SUPABASE_STATUS>
APP_USERNAME=demo
APP_PASSWORD=demo-password-123
# any random string of 32+ characters, e.g. `openssl rand -base64 48`
SESSION_SECRET=replace-with-a-random-string-of-at-least-32-chars
APP_TIMEZONE=Asia/Jakarta
```

If your CLI version prints a different key, use the `SECRET_KEY` (or legacy `SERVICE_ROLE_KEY`)
from `npx supabase@2 status --workdir scripts/dev-db`.

`npm run seed:demo` reads `.env.local` automatically (`node --env-file-if-exists`). `vite dev` does
not load non-`VITE_` variables into `process.env`, which is why the quick start exports them in the
shell first.

## What the scripts do

| Command                          | What it does                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:up`                  | `supabase start` with the minimal config in `scripts/dev-db/supabase/config.toml` (ports 54321 API, 54322 Postgres, 54323 Studio), then `scripts/dev-db/apply-schema.sh`.         |
| `scripts/dev-db/apply-schema.sh` | Pipes the whole `supabase/schema.sql` (every section, including ones added later) into `psql` inside the DB container and reloads PostgREST. Safe to re-run after schema changes. |
| `npm run seed:demo -- --reset`   | Deletes all rows from the app tables, then inserts the demo data. Without `--reset` it refuses to run when accounts already exist.                                                |
| `npm run db:down`                | Stops the stack and deletes its volumes.                                                                                                                                          |

The seed script refuses to write to any host other than `localhost`/`127.0.0.1` unless you pass
`--allow-remote` **and** set `DEMO_RESET_CONFIRM=yes`. `--reset` deletes **all** data — every app
table, app settings, non-default categories and all receipt photos — not only demo rows; never
point it at a database you care about. The public demo uses the same script daily, see
[DEMO.md](DEMO.md).

## What gets seeded

14 months of history ending today (in `APP_TIMEZONE`):

- **Accounts:** BCA (transfer fee presets), Mandiri Tabungan (monthly admin fee on the 28th),
  GoPay (top-up fee preset), OVO, Tunai, Kartu Kredit, and a USD investment account.
- **Income:** salary on the 25th, freelance every other month, a THR bonus, quarterly USD dividends.
- **Expenses:** rent, utilities, groceries (half with receipt-style `items`, source `ocr`), dining
  and rides (some from `telegram`), fuel, entertainment, health, education, shopping, subscriptions
  (Netflix, Spotify, iCloud+ with 11% tax) on the credit card, and a monthly card bill transfer.
- **Fees:** top-up admin fees as separate `Biaya Admin` rows with `[fee:<tx id>]` notes, and the
  Mandiri monthly fee with the same `[auto:monthly_fee:<account>:<YYYY-MM>]` marker the app uses,
  so the app does not record it again.
- **Recurring:** salary, rent and a GoPay top-up (auto-post, past occurrences carry the
  `[auto:recurring:…]` marker and `recurring:<id>:<date>` external id) plus a manual monthly item.
- **Debts:** a paylater and a loan in progress, a paid-off 0% phone installment; every payment is a
  `Cicilan & Hutang` expense linked from `debt_payments`.
- **Budgets:** six categories; Makanan & Minuman and Langganan roll over, Transportasi sits at ~85%
  and Hiburan is over 100% this month (with `budget_alerts` rows).
- **Goals:** an on-track emergency fund and a behind-schedule holiday fund, both linked to Mandiri
  with monthly `[goal:<id>]` transfers from BCA, and one completed goal.
- **Gold:** Antam buys and one sell with linked `Emas` transactions, plus cached world/Antam prices
  for today and yesterday.
- **Receivables:** one partially repaid, one fully repaid, one unlinked; money moves as `Piutang`
  transactions.
- **Kantong (v19):** GoPay has `Makan` and `Transport` (monthly) and Tunai a running `Parkir`
  envelope; the last three months of matching GoPay food/ride expenses and the parking rows carry
  `pocket_id`. Allocations fit inside the wallet balance, and `Transport` sits below its threshold
  this month (with a `pocket_alerts` row), so the dashboard shows "Kantong perlu perhatian".
- **Family member (v17/v18):** `sari` (Sari Wulandari, role `member`, active,
  `must_change_password` false) with `manage` access to GoPay in `account_permissions`. Its
  password is a random string hashed with scrypt in the app's format and never printed, so the
  account only fills the Pengguna screen (an admin can reset it there to sign in as the member).
- **Not seeded:** `integration_settings` stays empty, so Settings → Integrasi shows every value as
  env/default/"Belum diatur"; no secret is ever written.
- Each optional section is skipped with a log line when its tables are missing (schema v17–v19
  not run), and `--reset` wipes pockets, pocket alerts and `app_users` too.
- **Other:** a three-way split receipt (`split_group`), daily USD→IDR `fx_rates`, two account
  reconciliation checkpoints, and recent `activity_log` entries.

All names, companies and merchants are made up.

### Reproducibility

Amounts and choices come from a seeded PRNG, so the same day always produces the same data. Dates
are relative to today; set `DEMO_TODAY=YYYY-MM-DD` when seeding to pin them (the app itself still
uses the real date, so keep the two close for "this month" widgets to match).

## Regenerating screenshots

The images in `public/screenshots/` (used by the README and the landing page) come from this demo
stack. Start the dev server as in the quick start, then:

```bash
npm run db:up && npm run seed:demo -- --reset && npm run screenshots
```

`scripts/screenshots.mjs` (run through `npx` with Playwright and sharp, nothing is added to
`package.json` dependencies) signs in through `/login` with `APP_USERNAME`/`APP_PASSWORD` from
`.env.local`, forces the theme via `localStorage` `dk-theme`, keeps the Indonesian UI, disables
animations and toasts, waits for data, skeletons and charts, and writes `<name>.png` and
`<name>-dark.png`:

- **Desktop 1440×900:** dashboard, transactions, budgets, reports, accounts-detail (first account),
  goals, gold, recurring, settings, and `landing` (full page, logged out). v1.5 screens:
  `settings-integrations` and `settings-users` (Settings scrolled to that card), `profile`,
  `accounts-pockets` (GoPay detail scrolled to Kantong), `transaction-pocket` (new GoPay expense
  with the Kantong select open) and `dashboard-pockets` (current month, scrolled to the alert).
- **Mobile 390×844 @2x:** dashboard-mobile, transactions-mobile, landing-mobile, telegram-bot.

Dashboard, transactions and account detail step back one month so the shots show a full month.
`telegram-bot` is a static chat mock (`scripts/telegram-mock.html`) whose texts follow the real bot
reply formats. PNGs are palette-compressed with sharp (most are under 100 KB).

Options: `SCREENSHOT_ONLY=dashboard,telegram-bot` captures a subset, and `SCREENSHOT_URL` points at
another server. The script refuses non-local URLs unless you pass `--allow-remote`, because the
images get committed: never capture an instance that holds real data. Turn off `APP_TOTP_SECRET`
for the demo login. If you rename or add a shot, update `SCREENSHOTS` in `src/lib/landing.ts` and
the README gallery too.

## Limitations

- Receipt photos are not seeded (transactions have `items`, but no stored images). Uploading a
  photo works: local Storage is running and the app creates the `receipts` bucket on demand.
- Exchange rates and gold prices for days after the seed date are fetched live by the app (or fall
  back to the last cached value when offline).
- AI scan, Telegram bot and email reminders need their own env variables (see
  [ENVIRONMENT.md](ENVIRONMENT.md)); they are not required to browse the demo.
