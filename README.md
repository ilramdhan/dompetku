<div align="center">

# Dompetku

**A private, self-hosted personal finance tracker with a Telegram bot and receipt OCR.**

[![CI](https://github.com/ilramdhan/fintrack/actions/workflows/ci.yml/badge.svg)](https://github.com/ilramdhan/fintrack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TanStack Start](https://img.shields.io/badge/TanStack-Start-ff4154)](https://tanstack.com/start)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![Live demo](https://img.shields.io/badge/Live%20demo-demo.dompetku.ilramdhan.dev-2f7d5b?logo=googlechrome&logoColor=white)](https://demo.dompetku.ilramdhan.dev)

### 🚀 [Live demo → demo.dompetku.ilramdhan.dev](https://demo.dompetku.ilramdhan.dev)

Demo credentials are shown on the login page (one-click **Masuk ke demo**). Fake data, resets daily at 00:00 WIB.

</div>

Dompetku ("my wallet" in Indonesian) helps you track income, expenses, transfers, installments,
subscriptions, budgets, savings goals, gold and money people owe you, all in one place. Log a
coffee by sending _"kopi 25rb"_ to your own Telegram bot, or snap a photo of a receipt and let AI
fill in the details. Everything lives in **your own** Supabase database and **your own** Vercel
deployment, so your financial data stays yours.

It is built for **one person** (you): a single login defined in environment variables, no sign-up
pages, no shared servers. The interface is available in **Indonesian and English** (switch any
time), and amounts support **IDR and USD**.

> [!NOTE]
> Dompetku was designed with Indonesian users in mind (Rupiah, local banks and e-wallets, Antam
> gold prices, chat shortcuts like `25rb` / `2jt`), but it works for anyone who tracks money in
> IDR and/or USD.

## Table of contents

- [Live demo](#live-demo)
- [Screenshots](#screenshots)
- [Features](#features)
- [Deploy your own in ~20 minutes](#deploy-your-own-in-20-minutes)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Local development](#local-development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Live demo

Try it without installing anything: **<https://demo.dompetku.ilramdhan.dev>**

- The demo login is shown on the login page — click **Masuk ke demo** to sign in with one click.
- All data is fake and **resets daily at 00:00 WIB**; feel free to add, edit and delete.
- AI receipt scanning, photo upload, CSV import, restore, app settings and the Telegram bot are
  turned off in the demo. Want to run your own public demo? See [docs/DEMO.md](docs/DEMO.md).

## Screenshots

All screenshots use the fictional [demo data](docs/DEMO-DATA.md) and follow your GitHub theme (light
or dark). Regenerate them with `npm run screenshots` (see [Regenerating screenshots](docs/DEMO-DATA.md#regenerating-screenshots)).

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/dashboard-dark.png"><img src="public/screenshots/dashboard.png" alt="Dashboard: balances, assets, cash flow and spending per category"></picture>
</p>

<table>
  <tr>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/transactions-dark.png"><img src="public/screenshots/transactions.png" alt="Transactions"></picture><br><b>Transactions</b>: Search, filter and sort every transaction; CSV import/export and PDF.</td>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/reports-dark.png"><img src="public/screenshots/reports.png" alt="Reports"></picture><br><b>Reports</b>: Category trends over 6 or 12 months and a yearly recap.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/budgets-dark.png"><img src="public/screenshots/budgets.png" alt="Budgets"></picture><br><b>Budgets</b>: Monthly budgets with rollover and 80% / 100% alerts.</td>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/accounts-detail-dark.png"><img src="public/screenshots/accounts-detail.png" alt="Account detail"></picture><br><b>Account detail</b>: 12-month balance, spending per category and reconciliation.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/goals-dark.png"><img src="public/screenshots/goals.png" alt="Savings goals"></picture><br><b>Savings goals</b>: Progress, monthly target and projected completion date.</td>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/gold-dark.png"><img src="public/screenshots/gold.png" alt="Gold"></picture><br><b>Gold</b>: Antam and world gold prices with unrealised profit.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/recurring-dark.png"><img src="public/screenshots/recurring.png" alt="Recurring transactions"></picture><br><b>Recurring transactions</b>: Salary, rent and top-ups posted automatically when due.</td>
    <td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/settings-dark.png"><img src="public/screenshots/settings.png" alt="Settings"></picture><br><b>Settings</b>: Categories, app settings and optional two-factor login.</td>
  </tr>
</table>

**On your phone and in Telegram**

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/dashboard-mobile-dark.png"><img src="public/screenshots/dashboard-mobile.png" alt="Dashboard on mobile" width="240"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/transactions-mobile-dark.png"><img src="public/screenshots/transactions-mobile.png" alt="Transactions on mobile" width="240"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="public/screenshots/telegram-bot-dark.png"><img src="public/screenshots/telegram-bot.png" alt="Telegram bot: preview with Save/Cancel, budget alert and /saldo" width="240"></picture>
</p>

## Features

### Money tracking

- **Income, expenses and transfers** between accounts (banks, e-wallets, cash, and so on) with
  live balances.
- **IDR and USD** amounts with an automatic daily exchange rate.
- **Debts and installments** (paylater, loans) with payment tracking.
- **Subscriptions**, monthly or yearly, in IDR or USD, with optional tax.
- **Account fees**: transfer, top-up and monthly admin fees recorded as separate expenses.
- **Recurring transactions** (salary, rent, regular transfers) posted automatically when due.
- **Split transactions**: split one receipt across several categories.
- **Up to 5 receipt photos** per transaction, stored privately, plus search by receipt item name.
- **CSV import** with a preview, duplicate detection and optional creation of new categories or
  accounts.

### Budgets and goals

- Monthly **budgets per category**, with optional **rollover** of unused amounts.
- **Instant alerts at 80% and 100%** of a budget, on the web and in the bot.
- **Savings goals**, optionally linked to a savings account.

### Assets and net worth

- **Gold savings** with daily world (XAU) and Antam prices, optionally linked to an account.
- **Receivables** (money others owe you) with partial payments.
- **Net worth** that counts account balances, gold and outstanding receivables.

### Automation

- **Telegram bot**: record transactions by chat (`kopi 25rb`, `gaji masuk 8jt ke BCA`) or by sending
  a receipt photo. Every entry is shown as a **preview with buttons** before it is saved; `/undo`
  removes the last one. Slash commands give balances, reports, bills, budgets and more.
- **Receipt OCR** in the web app and the bot, using any OpenAI-compatible AI provider (for example
  Google Gemini or OpenAI).
- **Reminders** for upcoming bills via Telegram or email, plus daily, weekly and monthly reports,
  all scheduled by ready-to-import [n8n](https://n8n.io) workflows.

### Reports

- Dashboard with cash flow, category breakdowns and net worth charts.
- Monthly reports, a printable **yearly summary** with CSV export.
- **Per-account report** with a balance chart and **bank statement reconciliation**.
- Activity log of every change.

### Security and privacy

- **Your database, your server.** The browser never talks to the database; only server code holds
  the key, and database row-level security blocks everything else.
- Single-user login with a signed, `httpOnly` session cookie and a brute-force login limit.
- Optional **two-factor login (TOTP)** with any authenticator app.
- **Privacy mode** (eye icon or <kbd>Shift</kbd>+<kbd>H</kbd>) hides every amount, balance and
  chart value on the current device, handy when sharing your screen.
- Telegram bot answers **only** the chat IDs you allow.

### Reliability and experience

- **Backup and restore** of all data as one JSON file, plus an optional weekly automatic backup to
  Google Drive or email via n8n.
- **Error monitoring**: structured server logs and optional [Sentry](https://sentry.io) reporting.
- **Installable as an app** (PWA) on phone and desktop.
- **Indonesian / English** interface and **light / dark** theme.
- Mobile-first design that works on small screens.

## Deploy your own in ~20 minutes

You need free accounts on [GitHub](https://github.com), [Supabase](https://supabase.com) and
[Vercel](https://vercel.com). No coding is required.

1. **Fork** this repository to your GitHub account (the **Fork** button at the top right of this
   page).
2. **Create a Supabase project**, open **SQL Editor**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Import your fork into Vercel** (or use the button below).
4. **Add the required environment variables**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `APP_USERNAME`, `APP_PASSWORD` and `SESSION_SECRET` (a random string of at least 32
   characters).
5. **Deploy, open your site and log in.** Add the Telegram bot, OCR and reminders later if you
   want them.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ilramdhan/fintrack&env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,APP_USERNAME,APP_PASSWORD,SESSION_SECRET)

> [!IMPORTANT]
> The button deploys the app, but you still need to run `supabase/schema.sql` in your Supabase
> project (step 2) before logging in. Never share your `SUPABASE_SERVICE_ROLE_KEY`: it gives full
> access to your database.

The complete, beginner-friendly walkthrough (exact clicks, optional features, updating and
troubleshooting) is in **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**.
Every environment variable is explained in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Tech stack

| Layer      | Technology                                                                            |
| ---------- | ------------------------------------------------------------------------------------- |
| App        | [TanStack Start](https://tanstack.com/start) (React 19, SSR, server functions)        |
| Data & UI  | TanStack Router & Query, Tailwind CSS v4, shadcn/ui (Radix), Recharts, zod            |
| Database   | [Supabase](https://supabase.com) PostgreSQL + private Storage (server-only)           |
| Hosting    | [Vercel](https://vercel.com) serverless (also runs on [Lovable](https://lovable.dev)) |
| Automation | [n8n](https://n8n.io) + Telegram Bot API                                              |
| AI         | Any OpenAI-compatible API (receipt OCR and chat parsing)                              |
| Extras     | Resend (email, optional), Sentry (errors, optional)                                   |
| Quality    | Vitest, Testing Library, ESLint, Prettier, GitHub Actions                             |

How it all fits together, with diagrams: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Project structure

```text
src/
  routes/        Pages (file-based) and the /api/public/n8n/* API used by n8n
  components/    UI components (shadcn/ui in components/ui, lazy charts in components/charts)
  lib/           Business logic: *.server.ts = server-only, *.functions.ts = server functions,
                 other files = pure, tested helpers
  test/          Vitest test suites
supabase/        schema.sql — the whole database, in re-runnable sections v1–v13
n8n/             Importable n8n workflows: Telegram bot, schedules, error alerts, backup
docs/            Documentation
public/          PWA manifest, icons and self-hosted fonts
```

## Documentation

| Document                                     | What it covers                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Self-hosting guide](docs/SELF-HOSTING.md)   | Step-by-step install: Supabase, Vercel, first login, optional features, updates    |
| [Environment variables](docs/ENVIRONMENT.md) | Reference for every setting                                                        |
| [n8n, Telegram & email](docs/N8N.md)         | Telegram bot, reminders, reports, weekly backup, Google Drive, Gmail SMTP, Resend  |
| [Architecture](docs/ARCHITECTURE.md)         | Tech stack, directory layout, data flows, contributor rules                        |
| [FAQ](docs/FAQ.md)                           | Common questions and troubleshooting                                               |
| [Public demo](docs/DEMO.md)                  | How the live demo works and how to run your own                                    |
| [n8n templates](n8n/README.md)               | What each workflow file does                                                       |
| [Changelog](CHANGELOG.md)                    | Notable changes                                                                    |
| [Contributing](CONTRIBUTING.md)              | How to propose changes                                                             |
| [Security policy](SECURITY.md)               | How to report a vulnerability                                                      |
| [Accessibility](ACCESSIBILITY.md)            | Accessibility goals, supported environments, known gaps and how to report barriers |

## Local development

You need [Node.js](https://nodejs.org) 22 or newer (or [Bun](https://bun.sh), which CI uses) and
a Supabase project with the schema applied.

```bash
git clone https://github.com/<your-username>/fintrack.git
cd fintrack
npm install
cp .env.example .env    # then fill in at least the five required variables
npm run dev             # open the URL printed in the terminal
```

| Command             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Start the development server                                                 |
| `npm run build`     | Production build                                                             |
| `npm run lint`      | ESLint                                                                       |
| `npm run typecheck` | TypeScript check                                                             |
| `npm test`          | Run all tests once (`npm run test:watch` to keep watching)                   |
| `npm run format`    | Format the code with Prettier                                                |
| `npm run gen:types` | Regenerate database types (needs `SUPABASE_PROJECT_ID` and the Supabase CLI) |

More detail is in the [local development section of the self-hosting guide](docs/SELF-HOSTING.md).

## Contributing

Contributions are welcome, from typo fixes and translations to new features. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. Before
opening a pull request, make sure `npm run lint`, `npm run typecheck`, `npm test` and
`npm run build` all pass; CI runs the same checks. Contributor rules (schema sections, i18n,
privacy mode and more) are summarised in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#conventions-and-contributor-rules)
and listed in full in [AGENTS.md](AGENTS.md). For user-facing changes, also follow the
[accessibility expectations](ACCESSIBILITY.md#contributor-expectations).

## Security

Please **do not** open a public issue for security problems. See [SECURITY.md](SECURITY.md) for
how to report a vulnerability privately.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Ilham Ramadhan.

Every instance also serves short, public [privacy policy](src/components/legal/legal-content.ts)
(`/privacy`) and terms (`/terms`) pages written for a self-hosted deployment; they are linked from
the landing page footer. Edit `src/components/legal/legal-content.ts` (and the matching English
strings in `src/lib/i18n.tsx`) if your instance needs different wording.

## Acknowledgements

- [TanStack](https://tanstack.com) for Start, Router and Query
- [Supabase](https://supabase.com) for the database and storage
- [shadcn/ui](https://ui.shadcn.com) and [Radix UI](https://www.radix-ui.com) for UI components,
  [Lucide](https://lucide.dev) for icons and [Recharts](https://recharts.org) for charts
- [n8n](https://n8n.io) for workflow automation
- Technology logos on the landing page from [Simple Icons](https://simpleicons.org) (CC0 1.0)
- Fonts [Bricolage Grotesque](https://github.com/ateliertriay/bricolage),
  [Figtree](https://github.com/erikdkennedy/figtree) and
  [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), self-hosted via
  [Fontsource](https://fontsource.org) under the SIL Open Font License 1.1
  ([license](public/fonts/LICENSE-OFL.txt))
- Originally scaffolded with [Lovable](https://lovable.dev)

---

If Dompetku is useful to you, please consider giving it a star. Feedback, ideas and bug reports
are welcome in [GitHub Issues](https://github.com/ilramdhan/fintrack/issues).
