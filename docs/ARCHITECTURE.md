# Architecture

This document explains how Dompetku is put together: which tools it uses and why, where things
live in the repository, how the main features work behind the scenes, and the rules a contributor
must follow. It is written for developers, but every section starts with a plain-language summary
so you can follow along even if you are new to web development.

> [!TIP]
> Just want to run your own copy? You do not need any of this. Follow
> [SELF-HOSTING.md](SELF-HOSTING.md) instead.

- [Big picture](#big-picture)
- [Tech stack](#tech-stack)
- [System diagram](#system-diagram)
- [Directory structure](#directory-structure)
- [Database schema sections (v1–v25)](#database-schema-sections-v1v25)
- [Key flows](#key-flows)
- [Conventions and contributor rules](#conventions-and-contributor-rules)
- [Testing and CI](#testing-and-ci)

## Big picture

Dompetku is a **single-user** personal finance app. In plain words:

- The **web app** (what you open in your browser) and the **server code** live in the same
  project. The browser never talks to the database directly; it always asks the server, and the
  server checks that you are logged in first.
- The **database** is a Supabase (hosted PostgreSQL) project that _you_ own. Only the server holds
  the secret key to it.
- The **Telegram bot** and **scheduled jobs** (reminders, reports, backups) run through
  [n8n](https://n8n.io), an automation tool. n8n is deliberately "thin": it only forwards messages
  and timers to the app's API. All the actual logic (parsing, OCR, reports) is in this repository,
  where it is tested.
- **AI** (reading receipt photos and understanding chat messages like "coffee 25k") goes through
  any OpenAI-compatible API, so you can pick your provider.

## Tech stack

Versions are taken from `package.json` (`^` means "this version or a compatible newer one").

| Area               | Technology                                                                 | Version                                       | Why it is used                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | [TanStack Start](https://tanstack.com/start) on React                      | `@tanstack/react-start` 1.168.60, React ^19.2 | Full-stack React: server-side rendering, type-safe **server functions** (RPC from browser to server), file-based routes and API routes in one codebase.  |
| Routing            | [TanStack Router](https://tanstack.com/router)                             | 1.170.41                                      | Type-safe, file-based routing (`src/routes`), loaders and route-level error boundaries.                                                                  |
| Data fetching      | [TanStack Query](https://tanstack.com/query)                               | ^5.101                                        | Client cache for server-function results, background refetch and targeted invalidation after edits.                                                      |
| Build              | [Vite](https://vite.dev) + [nitro](https://nitro.build)                    | Vite 8.1.5, nitro 3.0 beta                    | Fast dev server and production build. nitro packages the server for the target host (Vercel preset when the `VERCEL` env var is set; Lovable otherwise). |
| Styling            | [Tailwind CSS](https://tailwindcss.com) v4                                 | ^4.2                                          | Utility CSS with semantic color tokens so light and dark themes share the same markup.                                                                   |
| UI components      | [shadcn/ui](https://ui.shadcn.com) on [Radix UI](https://www.radix-ui.com) | Radix 1.x/2.x                                 | Accessible, unstyled primitives (dialogs, selects, menus) copied into `src/components/ui` and themed locally.                                            |
| Icons              | [lucide-react](https://lucide.dev)                                         | ^0.575                                        | Consistent icon set.                                                                                                                                     |
| Charts             | [Recharts](https://recharts.org)                                           | ^2.15                                         | Dashboard and report charts. Loaded **lazily** through wrappers in `src/components/charts` to keep the first page load small.                            |
| Forms & validation | [zod](https://zod.dev) + react-hook-form                                   | zod ^3.25, RHF ^7.71                          | One schema validates input in the browser and again on the server (`src/lib/schemas.ts`).                                                                |
| Dates              | date-fns                                                                   | ^4.1                                          | Date math for periods, due dates and schedules.                                                                                                          |
| Database           | [Supabase](https://supabase.com) PostgreSQL via `@supabase/supabase-js`    | ^2.117                                        | Hosted Postgres with a free tier. Used **server-only** with the service-role key; RLS is enabled with **no policies**, so public keys can read nothing.  |
| File storage       | Supabase Storage                                                           | —                                             | Private `receipts` bucket for receipt photos, viewed through short-lived signed URLs.                                                                    |
| Hosting            | [Vercel](https://vercel.com) (region `sin1`, see `vercel.json`) or Lovable | —                                             | Serverless functions; the bot endpoint gets a 60 s limit for OCR (see `vite.config.ts`).                                                                 |
| Tests              | [Vitest](https://vitest.dev) + Testing Library + jsdom                     | Vitest ^4.1                                   | Unit tests for all pure logic plus a few component tests.                                                                                                |
| Lint & format      | ESLint 9 + typescript-eslint, Prettier 3                                   | —                                             | Consistent code style; `bun run lint` must pass in CI.                                                                                                   |
| CI                 | GitHub Actions (`.github/workflows/ci.yml`)                                | —                                             | Runs lint, typecheck, test and build on every pull request and push to `main`.                                                                           |
| Automation         | [n8n](https://n8n.io)                                                      | any recent                                    | Receives Telegram updates and runs schedules (reminders, reports, weekly backup) by calling `/api/public/n8n/*`.                                         |
| Chat bot           | Telegram Bot API                                                           | —                                             | Record transactions by chat or receipt photo, with inline buttons.                                                                                       |
| AI                 | Any OpenAI-compatible chat-completions API (`AI_API_URL`)                  | —                                             | Receipt OCR (vision model) and parsing of ambiguous chat messages (optionally a cheaper text model).                                                     |
| Email              | [Resend](https://resend.com) over plain `fetch`                            | —                                             | Optional direct reminder emails (n8n can send email instead).                                                                                            |
| Error monitoring   | [Sentry](https://sentry.io) (optional)                                     | no SDK                                        | Errors are posted as a Sentry "envelope" with `fetch`, so there is no SDK dependency. Without `SENTRY_DSN` errors are still logged as JSON lines.        |
| Fonts              | Bricolage Grotesque, Figtree, JetBrains Mono (from Fontsource)             | —                                             | Self-hosted in `public/fonts` (SIL Open Font License), so no third-party font requests.                                                                  |

Other external services used by the server: [open.er-api.com](https://open.er-api.com) for the
USD→IDR rate (with `FALLBACK_USD_IDR` as backup), [gold-api.com](https://gold-api.com) for the
world gold price and the public Antam (Logam Mulia) price page for Indonesian gold prices.

## System diagram

```mermaid
flowchart LR
  subgraph User
    B["Browser / installed PWA"]
    TG["Telegram app"]
  end

  subgraph Host["Vercel serverless (sin1) or Lovable"]
    SSR["SSR pages + server functions<br/>(requireAuth, CSRF)"]
    API["/api/public/n8n/*<br/>(x-api-key = N8N_API_KEY)"]
  end

  subgraph Supabase
    PG[("PostgreSQL<br/>RLS on, no policies")]
    ST[("Storage bucket<br/>receipts (private)")]
  end

  N8N["n8n workflows<br/>bot relay, schedules, backup"]
  AI["OpenAI-compatible AI<br/>OCR + text parsing"]
  RS["Resend (optional)"]
  GD["Google Drive / email<br/>(weekly backup)"]
  SE["Sentry (optional)"]

  B <-- "HTTPS, httpOnly session cookie" --> SSR
  SSR <-- "service-role key" --> PG
  SSR <--> ST
  TG <-- "updates / replies" --> N8N
  N8N <-- "JSON" --> API
  API <--> PG
  API <--> ST
  SSR --> AI
  API --> AI
  API --> RS
  N8N -- "GET /backup" --> API
  N8N --> GD
  SSR -. errors .-> SE
  API -. errors .-> SE
```

## Directory structure

Generated from `git ls-files`. `src/components/ui` (46 shadcn/ui files) and `public/icons` are
collapsed. Lovable planning drafts in `.lovable/` are omitted.

```text
.
├── .github/
│   ├── workflows/ci.yml           # CI: lint, typecheck, test, build
│   └── pull_request_template.md
├── AGENTS.md                      # Architecture rules for humans and AI agents (source of truth)
├── README.md
├── docs/                          # All documentation (this file, self-hosting, env, n8n, FAQ)
├── n8n/                           # Importable n8n workflow templates (01–05) + README
├── public/
│   ├── favicon.png
│   ├── fonts/                     # Self-hosted woff2 fonts + LICENSE-OFL.txt
│   ├── icons/                     # PWA icons (collapsed)
│   ├── manifest.webmanifest       # PWA manifest (no service worker)
│   └── (robots.txt and sitemap.xml are server routes in src/routes)
├── supabase/schema.sql            # Full database schema, sections v1–v25, safe to re-run
├── src/
│   ├── server.ts                  # Server entry wrapper: catches SSR errors → logError + error page
│   ├── start.ts                   # Global request middleware: security headers, error page, CSRF
│   ├── router.tsx                 # Router + QueryClient; "Unauthorized" → clear session cache, go to /login
│   ├── routeTree.gen.ts           # Auto-generated by TanStack Router (never edit)
│   ├── styles.css                 # Tailwind v4, semantic color tokens, @font-face, print styles
│   ├── assets/app-icon.png
│   ├── hooks/use-mobile.tsx
│   ├── routes/                    # File-based routes (see src/routes/README.md)
│   │   ├── __root.tsx             # HTML shell, pre-paint theme/privacy script, fonts, manifest
│   │   ├── index.tsx              # "/" → redirects to dashboard or login
│   │   ├── login.tsx              # Login form (+ TOTP step when enabled)
│   │   ├── _app.tsx               # Authenticated layout (session check, app shell)
│   │   ├── _app/                  # Pages: dashboard, transactions, reports, rekap (yearly),
│   │   │                          #   accounts, accounts_.$id (account report), debts, subscriptions,
│   │   │                          #   recurring, budgets, goals, gold, receivables, reminders, settings
│   │   └── api/public/n8n/        # API for n8n: bot, message, ocr, transactions, command, report,
│   │                              #   summary, reminders, reminders-email, reminders-send-email, backup
│   ├── components/
│   │   ├── app-shell.tsx          # Navigation, theme / language / privacy toggles, PageHeader
│   │   ├── crud-page.tsx          # Generic list + create/edit/delete page used by many sections
│   │   ├── transaction-dialog.tsx # Add/edit transaction (fees, receipts, split)
│   │   ├── receipt-scanner.tsx, receipt-gallery.tsx, split-editor.tsx, csv-import.tsx,
│   │   │   backup-restore.tsx, two-factor-card.tsx, account-reconcile.tsx, assets-overview.tsx, …
│   │   ├── charts/                # Lazy Recharts wrappers (index.tsx is the only public entry)
│   │   └── ui/                    # shadcn/ui primitives (collapsed)
│   ├── lib/                       # Business logic (see table below)
│   └── test/                      # Vitest suites (*.test.ts / *.test.tsx) + setup.ts
├── .env.example                   # Every environment variable with a short comment
├── vite.config.ts                 # Lovable/TanStack config; Vercel nitro preset when VERCEL is set
├── vercel.json                    # Vercel region (sin1)
├── vitest.config.ts, eslint.config.js, tsconfig.json, components.json, .prettierrc
└── package.json, bun.lock
```

### `src/lib` at a glance

File-name suffixes tell you where code may run:

| Suffix / file          | Runs where                                  | Meaning                                                                                                          |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `*.server.ts`          | Server only                                 | Touches the database, secrets or external APIs. Never import from a component.                                   |
| `*.functions.ts`       | Called from the browser, runs on the server | `createServerFn` endpoints. Each data function uses the `requireAuth` middleware and delegates to `*.server.ts`. |
| plain `*.ts` / `*.tsx` | Anywhere                                    | Pure, client-safe helpers. These are where unit tests focus.                                                     |

| File                                                                          | Purpose                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `db.server.ts`                                                                | The single Supabase client (service-role key), typed with `database.types.ts`.                                         |
| `database.types.ts`                                                           | Generated DB types (`bun run gen:types`); optional columns/tables added by hand.                                       |
| `session.server.ts`, `auth.functions.ts`, `auth-middleware.ts`                | Credential check, HMAC-signed cookie, login/logout/2FA server functions, `requireAuth`.                                |
| `totp.ts` / `totp.server.ts`                                                  | Pure TOTP (RFC 6238) helpers / verification against `APP_TOTP_SECRET`.                                                 |
| `password.ts` / `password.server.ts`, `session.ts`                            | Pure scrypt hash format + password policy / hashing; pure cookie payload + session-version check.                      |
| `profile.ts`, `profile.functions.ts`, `users.server.ts`                       | v17 profile & password change: validation/initials, server fns, `app_users` access with env fallback.                  |
| `login-throttle.ts` / `login-throttle.server.ts`                              | Brute-force limit (8 failures per 15 min) counted from `activity_log`, with in-memory fallback.                        |
| `session-cache.ts`                                                            | 5-minute client-side cache of the session check to avoid a round-trip on every navigation.                             |
| `api-key.server.ts`                                                           | `x-api-key` / Bearer check against `N8N_API_KEY` (timing-safe, ≥ 24 chars required).                                   |
| `finance.server.ts` / `finance.functions.ts`                                  | Core business logic shared by web and bot: CRUD, dashboard, reminders, fees, FX, external transactions, email sending. |
| `queries.ts`                                                                  | React Query keys/options and the `invalidateFor(qc, table)` map (`AFFECTS`).                                           |
| `schemas.ts`                                                                  | zod schemas for every form/entity.                                                                                     |
| `paginate.ts`                                                                 | `fetchAll` (pages past PostgREST's 1000-row cap) and validated page/sort params.                                       |
| `aggregate.ts`                                                                | Report helpers: call `dk_*` Postgres functions, JS fallback with identical results; `isMissingFunction`.               |
| `account-report.ts` / `.server.ts` / `.functions.ts`                          | Per-account monthly flows, balance chart and bank reconciliation.                                                      |
| `bot.ts` / `bot.server.ts` / `bot-request.ts`                                 | Telegram bot: pure parsing, commands, keyboards / DB work and drafts / request size guard (413).                       |
| `ocr.server.ts`                                                               | Calls the AI endpoint for receipt OCR and text parsing.                                                                |
| `receipt.server.ts`, `receipts.ts`                                            | Private bucket, uploads, signed URLs / pure helpers for up to 5 photos.                                                |
| `split.ts` / `.server.ts` / `.functions.ts`                                   | Split one receipt into several expense rows.                                                                           |
| `recurring.ts` / `.server.ts` / `.functions.ts`                               | Recurring transaction scheduling and lazy application.                                                                 |
| `budget.ts` / `budget.server.ts`                                              | Rollover math, 80%/100% threshold crossing / alert dedupe.                                                             |
| `fees.ts`                                                                     | Transfer/top-up/monthly fee parsing and dedupe markers.                                                                |
| `goals.ts`                                                                    | Savings goal progress helpers.                                                                                         |
| `assets.ts` / `assets.server.ts`                                              | Gold & receivable math / gold prices cache and `saveGold`.                                                             |
| `csv.ts`, `email.ts`                                                          | CSV import preview and reminder email builder (pure, shared).                                                          |
| `backup.ts` / `.server.ts` / `.functions.ts`                                  | Restore validation, FK order (`RESTORE_TABLES`), chunked upserts, export.                                              |
| `monitoring.ts` / `monitoring.server.ts`, `error-capture.ts`, `error-page.ts` | Structured error logs, Sentry envelope, SSR error recovery and fallback page.                                          |
| `activity.ts`                                                                 | Labels for `activity_log` actions.                                                                                     |
| `privacy.ts`, `privacy-sync.tsx`, `format.ts`                                 | Privacy-mode store and masking-aware `money()` / `compact()` formatters.                                               |
| `i18n.tsx`                                                                    | `LanguageProvider` / `useI18n`, ID→EN dictionary.                                                                      |
| `dates.ts`, `head.ts`, `utils.ts`                                             | Date helpers, page `<head>` helper, `cn()` class merge.                                                                |

## Database schema sections (v1–v25)

`supabase/schema.sql` is one file, organised in sections that are **safe to re-run** (`if not
exists` everywhere). A fresh install runs the whole file once. Existing installs run any newer
section. Every section after v1 is optional: the related feature hides itself or falls back until
the section is run.

| Section | Adds                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1      | Core tables: `accounts`, `categories`, `transactions`, `debts`, `debt_payments`, `subscriptions`, `budgets`, `goals`, `activity_log`, `fx_rates`; `account_balances` view; grants (service_role only); RLS; default categories.                                                                                                                                                                                                          |
| v2      | `transactions.receipt_path` and the private `receipts` storage bucket (5 MB limit).                                                                                                                                                                                                                                                                                                                                                      |
| v3      | `activity_log` (if missing), gold (`gold_purchases`, `gold_prices`) and receivables (`receivables`, `receivable_payments`).                                                                                                                                                                                                                                                                                                              |
| v4      | Account fees (`transfer_fees`, `topup_fees`, `monthly_fee`, `monthly_fee_day`), subscription `tax_percent`, index for auto-fee markers.                                                                                                                                                                                                                                                                                                  |
| v5      | Gold metadata (`gold_type`, `product_number`) and main query indexes.                                                                                                                                                                                                                                                                                                                                                                    |
| v6      | Gold linked to an account and a transaction (`account_id`, `transaction_id`).                                                                                                                                                                                                                                                                                                                                                            |
| v7      | Telegram bot: `transactions.external_id` (unique) for idempotency, `bot_drafts` previews.                                                                                                                                                                                                                                                                                                                                                |
| v8      | Savings goals linked to an account (`goals.account_id`).                                                                                                                                                                                                                                                                                                                                                                                 |
| v9      | Report aggregation functions `dk_month_totals`, `dk_category_totals`, `dk_month_category_totals`, `dk_monthly_net`.                                                                                                                                                                                                                                                                                                                      |
| v10     | `recurring_transactions`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| v11     | Budget `rollover` flag and `budget_alerts`.                                                                                                                                                                                                                                                                                                                                                                                              |
| v12     | Split transactions (`split_group`), multiple photos (`receipt_paths`), generated `items_search` column for receipt item search.                                                                                                                                                                                                                                                                                                          |
| v13     | `dk_account_monthly` function and `account_reconciliations`.                                                                                                                                                                                                                                                                                                                                                                             |
| v14     | `app_settings` (single row: name, tagline, logo data URL, time zone, base currency, landing, bot default account, reminder days).                                                                                                                                                                                                                                                                                                        |
| v15     | `ai_usage` log (one row per AI call: source, chat, kind, model, tokens) for the bot daily AI quota.                                                                                                                                                                                                                                                                                                                                      |
| v16     | `integration_settings` (key/value/is_secret): bot, AI, email and n8n values from Settings → Integrasi over env; secrets AES-256-GCM encrypted, excluded from backups.                                                                                                                                                                                                                                                                    |
| v17     | `app_users` (username, display_name, address, avatar data URL, password_hash, role, is_active, session_version): profile + in-app password change; backups carry profile fields only.                                                                                                                                                                                                                                                    |
| v18     | Multi-user: `app_users.must_change_password`, `account_permissions` (user_id, account_id, level `view`/`manage`, PK both, cascade), optional `activity_log.actor`.                                                                                                                                                                                                                                                                       |
| v19     | Kantong: `pockets` (account_id cascade, name unique per wallet, allocated, min_balance, period `monthly`/`none`), optional `transactions.pocket_id` (on delete set null), `pocket_alerts` (pocket, month, level `low`/`empty`).                                                                                                                                                                                                          |
| v20     | Subscription flexible interval: `subscriptions."interval"` (default 1, check ≥ 1) enables custom intervals like every 3 months, 6 months, 3 years.                                                                                                                                                                                                                                                                                       |
| v21     | Invoice core: `invoices` (number unique, customer, wallet, issue/due date, status `draft`/`unpaid`/`partial`/`paid`/`cancelled`, total, paid), `invoice_items` (cascade), `invoice_payments` (amount, date, method, `transaction_id`), `app_settings.invoice_prefix`.                                                                                                                                                                    |
| v22     | Per-member Telegram notifications: `notify_recipients` (user_id PK → app_users cascade, chat_id, enabled, send_report, send_reminders) and `notify_recipient_wallets` (optional wallet subset, cascade); read by `/api/public/n8n/notifications`.                                                                                                                                                                                        |
| v23     | Public invoice link: `invoice_shares` (invoice_id PK cascade, `token_hash` unique SHA-256 hex, created_at, expires_at, revoked_at). Not backed up. (v22 is reserved for another section.)                                                                                                                                                                                                                                                |
| v24     | Invoice payments: `payment_methods` (bank/qris, label, bank fields, `qris_image` data URL, optional `account_id`, active, position), `invoice_payment_methods` (invoice × method), `invoice_proofs` (file_path, claimed_amount, payer, note, status `pending`/`approved`/`rejected`, reject_reason, ip_hash, payment_id), `rate_limits` + `dk_rate_hit()` (not backed up).                                                               |
| v25     | Payment gateway: `gateway_transactions` (invoice_id → invoices **on delete restrict**, provider, `order_id` unique, `gateway_tx_id` unique, status `pending`/`success`/`failed`/`expired`/`refunded`/`partial_refund`, gross/refunded amount, payment_type, `payment_id` → invoice_payments set null, snap_token/redirect_url (stripped from backups), expires_at, claimed_at, last_error, filtered `raw`), `invoice_payments.refunded`. |

## Key flows

### Authentication and request security

1. The login form calls the `login` server function. It first checks the **throttle** (8 failures
   in 15 minutes locks login), then compares username/password with `APP_USERNAME` and either the
   v17 `app_users.password_hash` (scrypt, when set) or `APP_PASSWORD` (timing-safe hashing).
   `APP_PASSWORD_RESET=true` ignores the stored hash (recovery).
2. If `APP_TOTP_SECRET` is set, a 6-digit TOTP code is also required (any authenticator app).
3. On success the server sets `dk_session`: a base64url payload `{u, exp, sv}` plus an
   **HMAC-SHA256 signature** with `SESSION_SECRET` (≥ 32 chars). The cookie is `httpOnly`,
   `secure`, `SameSite=None; Partitioned` (so Lovable's iframe preview works) and lasts 7 days.
4. Every data server function uses the `requireAuth` middleware, which verifies the signature,
   expiry and session version (`sv` vs `app_users.session_version`, cached ~45 s; a missing `sv`
   counts as 1 and a missing row/table accepts the cookie, so upgrading logs nobody out). A password
   change bumps the version, signing out every other device. Failures throw `Unauthorized`; `router.tsx` then clears the client session cache and
   redirects to `/login`.
5. Global request middleware in `src/start.ts` adds **CSRF protection** to server functions
   (TanStack's `createCsrfMiddleware`) and baseline security headers (`X-Content-Type-Options`,
   `Referrer-Policy`, `Permissions-Policy`). There is intentionally no `X-Frame-Options`/CSP
   because Lovable previews run in an iframe.
6. n8n routes do not use the cookie. They require `x-api-key: <N8N_API_KEY>` (or
   `Authorization: Bearer`); a missing or short key makes them answer `503`.

### Kantong (pockets, v19)

- **What.** A pocket earmarks part of **one wallet's** money (Mandiri → Makan 500rb). It does not
  replace category Budgets: budgets judge spending per category across all wallets, pockets track
  physical money inside one wallet. Amounts are in the wallet's currency (`amount`, like balances).
- **Math** (`pockets.ts`, pure, tested). `monthly`: remaining = allocated − pocket expenses this
  month + pocket incomes this month (month in the app time zone); `none`: running envelope over all
  time. A transfer **out** of the wallet may carry a pocket (counts as spending); the receiving
  side never does. `unallocated = wallet balance − Σ max(0, remaining)` over active pockets, shown
  negative with a warning when over-allocated. Example: BCA balance 1.000.000, Makan 500.000 with
  150.000 spent (remaining 350.000) and Transport 250.000 unused → unallocated 400.000.
- **Saving.** `transactions.pocket_id` is optional: `insertTxRow`/`updateTransaction` drop it and
  retry when v19 is not run. `saveTransaction` validates that the pocket belongs to the source
  wallet (`assertPocketForTx`); an edit that moves the row to another wallet without picking a
  pocket clears it (`pocketOnEdit`). Splits, CSV import and recurring posts never set a pocket.
- **Alerts.** `pocketAlertsFor(tx, prev)` (pockets.server.ts) runs after web and bot saves:
  `low` when remaining crosses ≤ `min_balance`, `empty` when it crosses ≤ 0 (only on the way
  down, current month only). Deduped per pocket/month/level in `pocket_alerts` (an `empty` also
  claims `low`); missing table → alert without dedupe. Never throws. Web shows a toast and a
  dashboard card; the bot appends the line to the "saved" reply.
- **RBAC.** View on a wallet → see its pockets; manage → assign transactions to them and create,
  edit, archive or delete them (`assertWalletManage`). `maskTx` clears `pocket_id` when the source
  wallet is hidden. The bot (`#tag`, `/kantong`) is owner-only like the rest of the bot.

### Invoice (v21)

- **What.** Bills to customers with automatic numbers `<PREFIX>-YYYYMM-####` (prefix in
  Settings → Aplikasi, default `INV`; sequence per issue month, retried on a unique violation),
  line items, one receiving wallet and manual (partial) payments. IDR only.
- **Math & rules** (`invoices.ts`, pure, tested). The server recomputes the total from items and
  never trusts a client total. Stored status: `draft`/`cancelled` are manual (`issue`, `cancel`,
  `reopen`, `unissue`); `unpaid`/`partial`/`paid` are derived from the sum of payments after every
  payment change. **Overdue** is computed (`due_date < today` in the app time zone, open invoices
  only) and never stored. Paid/cancelled invoices cannot be edited; an edit may not drop the total
  below what was paid or move the wallet once payments exist.
- **Payments.** Each payment books one income transaction in category "Invoice" on the invoice
  wallet via `createFromExternal` with `external_id = invoice_pay:<payment id>` (idempotent).
  Deleting a payment or the invoice deletes those transactions. A payment never exceeds the
  remaining amount (re-checked after insert against concurrent payments).
- **RBAC.** `invoices` is an admin module; the server fns still scope by `accountScope()` and
  `assertWalletManage` so the module can be granted to members later.
- **Reports (#98).** `/invoices/report` (admin): month picker + `?account=` (intersected with
  `accountScope()` via `reportScope()`) show issued (issue date in the month, draft/cancelled
  excluded), received (payments dated in the month) and outstanding at month end, per wallet, plus
  an aging view of open invoices as of today (not yet due, 1–30, 31–60, 61–90, > 90 days past due)
  and a paginated, sortable list of payments across invoices. Pure math in `invoice-report.ts`
  (tested), DB in `invoice-report.server.ts`. The dashboard shows an admin-only "Invoice belum
  lunas" card. **Net worth does not include outstanding invoices**: income is booked only when a
  payment is recorded, so counting open invoices would be accrual and double count after payment.

### Public invoice link (v23)

- **Token.** Invoice detail → **Bagikan** creates a link `/i/<token>`: 32 random bytes (node
  `randomBytes`) as base64url. Only `sha256(token)` is stored in `invoice_shares.token_hash`
  (unique), so the raw link is shown once; "Buat ulang tautan" rotates it (old link dies),
  "Cabut" sets `revoked_at`, an optional expiry sets `expires_at`. Token hashes are never backed up.
- **Lookup.** `getPublicInvoice` is the only `public` fn that reads financial data. It rejects a
  malformed token before any DB access, then looks up by hash equality. Unknown/revoked/expired
  tokens, draft/cancelled invoices, missing v21/v23 tables and DB errors all return `null` → the
  router's 404, so the response does not reveal which case applied.
- **Payload.** `toPublicInvoice()` (pure, tested) builds a whitelist: number, issue/due date,
  customer name, currency, display status (incl. overdue), items, total, paid, remaining and
  payments as date + amount. The wallet, `notes` (private), email/phone, ids, payment
  method/reference and transaction ids never leave the server.
- **Page.** `/i/$token` sits outside `_app`: `noindex, nofollow` (root head + `X-Robots-Tag`),
  `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, not in the sitemap. It
  follows `?lang=` (`LANG_PREFIXES` in `lang.ts`), uses public branding (name + logo endpoint) and
  never masks amounts. "Cetak / simpan PDF" is `window.print()` with print CSS forced to black on
  white. `InvoicePaymentInstructions` is an empty slot filled by #94.
- **Demo.** The page works; creating links is capped like other inserts (`assertDemoCapacity`)
  and every demo link expires within `DEMO_SHARE_MAX_DAYS` (1 day).

### Invoice payment methods, proofs and verification (v24)

- **Methods.** Settings → Metode pembayaran (admin) manages bank accounts and static QRIS
  (`isLogoDataUrl` ≤200 KB raster). The invoice form may pick methods; none = all active
  (`visibleMethods`). The public page receives `toPublicMethod()` only (no `account_id`, no ids;
  the visitor refers to a method by its index).
- **Upload.** `submitInvoiceProof` (public) validates by hand, then `submitProof()`: demo off →
  persistent rate limit per IP and per token (HMAC with an HKDF key from `SESSION_SECRET`,
  `dk_rate_hit` fixed windows, fail closed) → hashed token lookup (`activeShareInvoiceId`, only
  unpaid/partial, same error otherwise) → amount ≤ remaining, cleaned text, ≤3 pending →
  magic-byte sniffing ≤5 MB → private `receipts` bucket `inv/<invoice id>/<uuid>.<ext>` → row.
  The browser re-encodes the photo as JPEG first (drops EXIF). The answer is `{ ok: true }`.
- **Status.** `displayStatus(inv, today, pendingProofs)` returns `verifying` ("Menunggu
  verifikasi") for open invoices with pending proofs; the stored status is unchanged.
- **Queue.** Invoice page → Bukti transfer: 2-minute signed preview, **Setujui** claims the row
  with `update … where status = 'pending'` (no double booking), then `bookPayment()` (the
  `recordPayment()` path, income `invoice_pay:<payment id>`) and stores `payment_id`; a failed
  booking releases the claim. **Tolak** requires a reason. Deleting an invoice removes its proof
  files.

### Invoice payment gateway — Midtrans (v25)

User guide: [PAYMENT-GATEWAY.md](PAYMENT-GATEWAY.md).

- **Layers.** `src/lib/gateway/types.ts` (pure: `PaymentGateway` interface with
  `createPayment`/`verifyWebhook`/`fetchStatus`/`refund`, status set, transition machine
  `nextStatus`, order ids, `gatewayAmount`, refund rules), `gateway/midtrans.ts` (pure: hosts,
  signature input, notification/status parsing, status mapping, Snap body), `midtrans.server.ts`
  (fetch with Basic `base64(serverKey + ":")`, 10 s timeout, SHA-512 + `timingSafeEqual`) and
  `payments.server.ts` (DB, booking, refunds). Config only via `getIntegrations`
  (`MIDTRANS_ENABLED`/`_SERVER_KEY`/`_CLIENT_KEY`/`_PRODUCTION`).
- **Pay now.** Public `createGatewayPayment`: demo off → `rateHit` per IP then per token hash →
  hashed token lookup → amount = remaining (server, whole rupiah) → reuse a live pending order of
  the same amount or create a Snap order (`<invoice number>-<random>`, 24 h expiry,
  `callbacks.finish = /i/<token>?gw=1`). The browser gets token, redirect URL, client key and the
  fixed snap.js URL only; snap.js is injected on click with `data-client-key`, `redirect_url` is
  the fallback. `?gw=1` only shows "being processed".
- **Webhook** `POST /api/public/payments/midtrans`: 403 demo, 503 off/no v25 (also a key/mode
  mismatch: an `SB-` key with production or vice versa disables the gateway), ≤64 KB body, then the
  pure signature check first; only bad payloads/signatures hit a per-IP `rateHit` (429 once over),
  so a spoofed `X-Forwarded-For` can never block signed notifications. Then **always** Get Status →
  amount must match the stored row → `nextStatus` (late expire/cancel/deny never downgrade success;
  refund only from success) applied with a conditional update on the read status. A chargeback
  without refund entries keeps the status and sets `last_error` for a manual check.
- **Booking claim.** Entering a paid state books once: only a stale claim (>10 min, crash) is
  released, conditional on its exact `claimed_at`; the claim is one atomic
  `update claimed_at = now, last_error = null where payment_id is null and claimed_at is null`;
  `bookPayment()` (method `Midtrans (<type>)`, reference = Midtrans transaction id, income
  `invoice_pay:<payment id>`); the link and every `last_error` write are conditional on
  `payment_id is null`. A failed attempt (incl. business errors such as "invoice already paid",
  shown in `last_error`) releases its own claim; crash recovery links a payment found under the
  transaction id or order id. Unknown orders → 200 (ignored); transient errors → 503.
- **Refunds.** Admin `refundGatewayFn` re-reads the order (settlement/partial_refund + refundable
  payment type, ShopeePay/OVO full only) and sends `/v2/<order>/refund` with a rounded amount and
  `refund_key = rf-<row>-<n>`, where n = 1 + max(refunds listed by Midtrans, local
  `invoice_refund:<row>:%` expenses) so a lagging status never reuses a key. A 406 (duplicate key) is
  accepted only when the re-read status lists that key with the same amount; otherwise it fails and
  nothing is booked from the request. Every refund in the verified status (also dashboard ones)
  becomes a reversing **expense** in category "Invoice" (`invoice_refund:<row id>:<refund key>`) and
  sets `invoice_payments.refunded`; `paidSum`, the invoice report (`netPaymentAmount`) and the
  public payment list net it out, so `syncInvoice` derives partial/unpaid. Nothing is deleted.
- **Refund hold.** A newly booked refund sets `gateway_transactions.refund_hold`: the public pay
  button and the due/overdue reminders skip that invoice until the admin clicks **Tagih ulang**
  (`releaseRefundHoldFn`) or cancels it.
- **Stale orders.** `retirePendingOrders()` expires pending orders whose amount no longer equals
  the remaining amount (or whose invoice is no longer open) via best-effort
  `POST /v2/<order>/expire` + local `expired`; it runs before creating a new order and after every
  `syncInvoice`/manual status change. A late verified settlement still wins (`nextStatus`).
- **History.** Invoices with pending/paid orders cannot be deleted (FK restrict + app check, fail
  closed on DB errors); gateway payments cannot be deleted by hand. `gateway_transactions` is backed
  up without Snap tokens. `callbacks.finish` is sent only when `PUBLIC_SITE_URL` is set (never from
  the Host header). Test-only `MIDTRANS_API_BASE`/`MIDTRANS_SNAP_BASE` (env, sandbox mode with an
  `SB-` key only) point the server at a mock; with an override the browser skips snap.js, uses
  `redirect_url`, and only then may follow a non-Midtrans redirect host.

### Users and wallet-level access (RBAC, v18)

- **Roles.** The `APP_USERNAME` user is always the **owner/admin**: never demoted, deactivated or
  deleted, and the only user the TOTP secret, the Telegram bot and the n8n API act for. The owner
  adds **members** (`app_users.role = 'member'`) in Settings → Pengguna with a temporary password
  (`must_change_password`; the member must change it before any data fn works). Member usernames
  are lower-case and immutable; the editable label is the full name (`display_name || username`).
- **Login.** `authenticate()` (users.server.ts) checks the owner first, then an active member's
  own scrypt hash. Member cookies carry `r: "member"`, so a member cookie can never validate as the
  owner's and vice versa.
- **Principal per request.** `requireAuth` resolves the cookie with `resolvePrincipal()`: owner
  = signature + session version as before; member = active row, matching `session_version` and
  wallet grants from `account_permissions` (cached ~30 s per instance, dropped on every admin
  change; DB errors never invent access). Context: `{ user, userId, role, access, can() }`.
  Deactivating, resetting the password or deleting bumps/removes the row, so the member's cookies
  stop working within the cache TTL (immediately on the instance that made the change).
- **Permission model** (`permissions.ts`, pure, tested). Strings `wallet:view`,
  `wallet:manage`, `module:<name>`; `ROLE_CAPABILITIES` gives the admin `*` and members the
  dashboard/transactions/accounts/reports/profile modules; one resolver `can(subject, permission,
resource)`. New permissions become new strings (and, for per-resource grants, a new grant
  table keyed like `account_permissions`) without touching callers.
- **Server-fn classification.** `server-fn-access.ts` lists every `createServerFn` as `public`,
  `session` (`requireSession`), `member` (`requireAuth` + RBAC scoping) or `admin`
  (`requireAdmin`). `src/test/server-fn-access.test.ts` fails CI when a fn is unclassified, uses a
  different middleware, or is member-accessible without consulting `rbac.server.ts`.
- **Data scoping.** `accountScope(ctx)` (rbac.server.ts) returns the permitted account ids (null =
  all for the owner). Member reads filter transactions with `account_id.in.(…) or
to_account_id.in.(…)`, balances/accounts with `id in (…)`, and always use the **JS aggregation
  path** (the v9 `dk_*` functions aggregate globally). Income/expense totals count the wallet they
  were recorded on; the member net worth is the summed balance of the permitted wallets (no gold,
  receivables, goals or debts). `maskTx()` replaces a non-permitted side of a transfer by "Dompet
  lain" and clears its id.
- **Writes.** Members need `manage` on the old and new wallet (both sides for transfers), every
  transaction needs an account, categories are read-only, and receipt photos are uploaded under
  `m/<user id>/` — a member can only attach or view their own uploads or photos of transactions on
  permitted wallets.

### Data access and caching

```mermaid
sequenceDiagram
  participant C as Component
  participant Q as React Query
  participant F as Server function (*.functions.ts)
  participant S as *.server.ts
  participant DB as Supabase
  C->>Q: useQuery(queryOptions from queries.ts)
  Q->>F: call (cookie sent automatically)
  F->>F: requireAuth + zod validation
  F->>S: business logic
  S->>DB: service-role query
  DB-->>C: rows (cached by React Query)
  C->>F: mutation (save/delete)
  C->>Q: invalidateFor(qc, table) → only affected keys refetch
```

- The browser never receives the Supabase key; everything goes through server functions.
- After a create/update/delete, call `invalidateFor(qc, table)`. The `AFFECTS` map in
  `queries.ts` lists which query keys each table touches (for example, a transaction change
  refreshes balances, dashboard and reports). Never call a blanket `invalidateQueries()`.
- Long history lists (transactions, activity) use validated **server-side pagination and
  sorting**. Small dashboard widgets and form dropdowns load bounded/full lists.
- `session-cache.ts` remembers a successful session check for 5 minutes in the browser so page
  changes do not wait for a server round-trip. Security is still enforced by `requireAuth`.

### Telegram bot (draft → ✅ idempotency)

```mermaid
sequenceDiagram
  participant U as Telegram user
  participant N as n8n (workflow 01)
  participant A as POST /api/public/n8n/bot
  participant DB as Supabase
  U->>N: "coffee 25k" or receipt photo
  N->>A: {update_id, chat_id, text | image_base64, callback_data?, chat_type?, reply_to_bot?, bot_username?}
  A->>A: group chat? only @mention / reply to bot / /cmd, else method "none"
  A->>A: chat_id in BOT_ALLOWED_CHAT_IDS? (empty list → refuse all)
  A->>A: quickParse → keyword/history category → AI only if ambiguous
  A->>DB: insert bot_drafts row
  A-->>N: {method:"send", text, reply_markup: ✅ ❌ 🏷 🏦 🔁 ✏️}
  N-->>U: preview with buttons
  U->>N: tap ✅
  N->>A: callback_data
  A->>DB: createFromExternal(external_id = "draft:<id>") (unique index)
  A-->>N: {method:"edit", text:"Saved"}
```

- Logic lives in the web app (`bot.ts` pure, `bot.server.ts` DB). n8n only relays
  `{method, text, reply_markup}` to the Telegram Bot API.
- Double taps and retries are harmless: the unique `external_id` makes the save idempotent.
- `/bayar` (`botPay`) and `/tarik` (`cashWithdraw`) bypass `bot_drafts` and write immediately.
- AI results are snapped to existing categories/accounts (`matchCategory`); the bot never
  creates categories. `BOT_TEXT_AI` (`auto` / `always` / `never`) and `AI_MODEL_TEXT` control token
  spend; chats without an amount or over 300 characters skip AI, and `BOT_AI_DAILY_LIMIT` caps
  bot AI calls per chat per day (logged in `ai_usage`). Requests over 4.5 MB are rejected early with `413` (`bot-request.ts`).
- On Vercel, `/api/public/n8n/bot` is emitted as its own function with `maxDuration: 60` because
  OCR can take 5–15 seconds.

### Receipt OCR

The web scanner (`receipt-scanner.tsx`) and the bot both send the image to `ocr.server.ts`, which
calls `AI_API_URL` with `AI_MODEL` (a vision model) and asks for structured JSON (merchant, date,
total, items). The result pre-fills a transaction (web) or a draft (bot); the user confirms before
anything is saved. Item names are stored and searchable (v12 `items_search`).

### Receipt storage and signed URLs

Photos are uploaded by the server into the private `receipts` bucket (lazy-created by
`receipt.server.ts` if missing). Transactions store only paths: `receipt_paths` (up to 5) with
`receipt_path` = the first, for compatibility. To view a photo the server creates a **signed URL
valid for 5 minutes**. When a transaction is deleted, photos are removed only if no other row
(for example another part of a split) still references them.

### Reminders, monthly fees and recurring transactions (lazy jobs)

There is no cron inside the app. Instead, work that "should happen monthly" runs **lazily** the
next time it matters:

- When the dashboard, reminders or the bot load, `applyMonthlyFees()` creates any due monthly
  account fee as an expense in category "Biaya Admin", then `applyRecurring()` posts due recurring
  transactions.
- Both are **idempotent**: fees are deduplicated by a notes marker from `fees.ts`; recurring items
  by a notes marker plus `external_id`. Recurring application never throws.
- One run posts at most the latest `RECURRING_CATCHUP_CAP` (12) missed occurrences per schedule;
  older ones are skipped. Resuming a paused schedule (`resumeNextDue`) jumps to the first
  occurrence on/after today, so nothing missed while paused is posted.
- Reminders (`/reminders`, `/api/public/n8n/reminders`, `-email`, `-send-email`) list upcoming
  subscription and installment bills. n8n workflow 02 calls them on a schedule; direct email uses
  Resend when `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_TO` are set.

### Budgets: rollover and alerts

`budget.ts` holds pure math: unused budget can roll over to the next month, and a function
detects when spending **crosses** 80% or 100%. After a web or bot save, `budgetAlertsFor()` checks
the affected budget, records the alert in `budget_alerts` (once per budget per month) and returns
a message. Alerts never cause a save to fail.

### Split transactions

A split is N ordinary expense rows sharing a `split_group` UUID, so reports and budgets work
without special cases. `split.server.ts` saves/deletes the group as a unit.

### Fees, gold and receivables

- Transfer, top-up and monthly account fees are separate expense transactions in category
  "Biaya Admin".
- Gold records linked to an account create an expense (buy) or income (sell) transaction in
  category "Emas" (`saveGold`); edits sync it and deletes remove it.
- Linked receivables move money as transactions in category "Piutang".
- Net worth = account balances + outstanding linked receivables + gold value, so these count as
  assets exactly once.
- Gold prices (world XAU and Antam) are cached one row per day per source in `gold_prices`, with
  "last cached" and then "estimate" fallbacks.

### Reports aggregation

Reports call Postgres functions (`dk_*`, v9/v13, executable only by `service_role`) through
helpers in `aggregate.ts` / `account-report.server.ts`. If the function does not exist yet
(`isMissingFunction()`), the code falls back to fetching rows and summing them in JavaScript,
producing identical results. Because PostgREST returns at most 1000 rows per request, the fallback
uses `fetchAll` (`paginate.ts`), which pages with `.range()` and a stable order up to a 100,000-row
safety cap.

### Backup and restore

- **Export**: Settings → backup downloads one JSON file with every table (`exportBackup()`); n8n
  workflow 05 fetches the same file from `GET /api/public/n8n/backup` weekly and stores it in
  Google Drive or sends it by email.
- **Restore**: `backup.ts` validates the file, orders tables by foreign keys (`RESTORE_TABLES`),
  remaps natural-key conflicts in merge mode and strips generated columns. The browser sends the
  data in chunks (≤ 500 rows / ≤ 2 MB per request, files up to 20 MB) to stay under Vercel's
  4.5 MB body limit. "Replace" mode deletes current data first and requires typing a confirmation
  word. Tables missing from the database are skipped.

### Monitoring

All server errors go through `logError()` (`monitoring.server.ts`): one JSON line in the host's
logs (Vercel → Logs) and, if `SENTRY_DSN` is set, a Sentry envelope sent with `fetch`. It never
throws. `server.ts` and `start.ts` catch SSR failures and return a friendly error page.

### App version and update check

`vite.config.ts` injects `__APP_VERSION__` (package.json), `__APP_COMMIT__` (`VERCEL_GIT_COMMIT_SHA`
or `git rev-parse`, empty if unavailable) and `__APP_BUILD_DATE__` via `define` (declared in
`src/version.d.ts`). Pure helpers in `version.ts` (semver compare, repo parsing, release URLs) fall
back safely under vitest. `getLatestRelease` (public, `version.server.ts`) asks the GitHub releases
API with a 3 s timeout and caches 6 h in memory; any failure returns `null`. `<VersionBadge>` renders
it in the sidebar, Settings → About and the landing page.

### Privacy mode

Privacy mode hides money on screen (for example when sharing your screen). The eye icon or
**Shift+H** toggles it per device (`localStorage` key `dk-privacy`). An inline script in
`__root.tsx` adds `.privacy` to `<html>` before the first paint; `PrivacySync` keeps it in sync
after hydration. `money()` / `compact()` return a fixed-length mask when on, and components
showing amounts call `usePrivacy()` to re-render. Percentages and counts stay visible; bot
messages, exports and login are never masked.

### Language (i18n)

The UI is written in Indonesian and translated to English at runtime. `t("Indonesian text")`
returns the input when the language is `id`, or the English entry from the `DICT` in
`i18n.tsx` when it is `en`.

### Dark mode

A `.dark` class on `<html>` (stored in `localStorage` key `dk-theme`) is set by the same
pre-paint inline script, so there is no flash of the wrong theme. All colors are semantic
Tailwind tokens defined in `styles.css`.

### PWA

The app is installable via `public/manifest.webmanifest` and icons. There is **no service
worker** on purpose: it keeps Lovable previews and deployments free of stale caches.

## Conventions and contributor rules

`AGENTS.md` is the authoritative list. The most important rules:

1. **Server-only data access.** Only `*.server.ts` code imports `db()`. Every data server
   function uses `requireAdmin`, or `requireAuth` plus RBAC scoping, and is classified in
   `server-fn-access.ts`. Never add Supabase keys or clients to browser code.
2. **Shared business logic.** Put logic in `finance.server.ts` (or a focused `*.server.ts`) so
   the web app and the bot/n8n API share it. Keep pure logic in client-safe files with tests.
3. **Graceful degradation.** New tables/columns go into a **new optional schema section**. Reads
   of optional tables go through `isMissingTable()` and return empty/`{ ready: false }`; SQL
   function calls check `isMissingFunction()` and fall back to JS. Pages must never crash because
   a user has not run the newest section.
4. **Money display.** Always format with `money()` / `compact()` and call `usePrivacy()` in the
   component. Use `{ reveal: true }` only in form/editing previews, and `secret()` for sensitive
   non-money values (gold grams).
5. **Styling.** Use semantic color tokens (no hard-coded colors) so both themes work. Design
   mobile-first: every screen must work at phone width without horizontal scrolling. Import
   charts only from `src/components/charts`.
6. **Text.** Wrap every user-visible string in `t("…")` and add its English translation to the
   dictionary in `i18n.tsx`.
7. **Cache invalidation.** After a mutation, call `invalidateFor(qc, table)`; add the table to
   `AFFECTS` in `queries.ts` if it is new.
8. **Errors.** Log server errors with `logError()`.
9. **Lovable sync.** Do not rewrite published git history (no force-push/amend of pushed commits).

### Checklist: adding a new table or feature

- [ ] Add a new section `-- ===== vN: … =====` to `supabase/schema.sql` (idempotent, RLS enabled,
      grants to `service_role` only).
- [ ] Add the table/columns to `src/lib/database.types.ts` (mark optional if the section may not
      have been run), or regenerate with `bun run gen:types`.
- [ ] Read through `isMissingTable()` / `isMissingFunction()` so old databases keep working.
- [ ] Add the table to `RESTORE_TABLES` in `backup.ts` in foreign-key order (and conflict keys).
- [ ] Add the table to the `AFFECTS` map in `queries.ts`.
- [ ] Add activity labels in `activity.ts` (`<table>.create|update|delete`).
- [ ] Wrap new UI text in `t()` and add English entries in `i18n.tsx`.
- [ ] Put pure logic in a client-safe file and add Vitest tests in `src/test`.
- [ ] Update `AGENTS.md` and the docs if you add a rule, env var or endpoint.

## Testing and CI

```bash
bun run lint        # ESLint
bun run typecheck   # tsc --noEmit
bun run test            # Vitest, once
bun run test:watch  # Vitest in watch mode
bun run build       # production build
```

- Tests live in `src/test` and mostly cover pure modules (bot parsing, fees, budgets, recurring,
  split, receipts, backup, TOTP, pagination, privacy, monitoring, aggregation). Component tests
  use Testing Library with jsdom (`src/test/setup.ts`).
- The build needs **no secrets**: environment variables are read only at runtime.
- GitHub Actions (`.github/workflows/ci.yml`) installs with Bun and runs lint, typecheck, test and
  build on every pull request and on pushes to `main`. Keep all four green.
