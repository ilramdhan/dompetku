# Frequently asked questions

Quick answers for everyday users and developers. Installation: [SELF-HOSTING.md](SELF-HOSTING.md). Settings: [ENVIRONMENT.md](ENVIRONMENT.md). Bot and automation: [N8N.md](N8N.md).

## General

<details>
<summary><strong>What is Dompetku?</strong></summary>

A self-hosted personal finance tracker: income, expenses, transfers, debts/pay-later, subscriptions (IDR and USD), budgets, savings goals, gold, receivables, recurring transactions and reports — plus an optional Telegram bot and receipt OCR. You run your own copy; there is no central service.

</details>

<details>
<summary><strong>Is my data private?</strong></summary>

Yes. Your data lives in **your own** Supabase project, and the website runs in **your own** Vercel account. The project author has no access to either.

- The browser never talks to the database. Only the server does, using your secret key.
- Row-level security is on with no policies, so the public Supabase keys can read nothing.
- Receipt photos are in a private Storage bucket and shown via links that expire after a few minutes.
- Login uses a signed, httpOnly cookie; you can add a 6-digit authenticator code (2FA).
- If you enable OCR, receipt photos and ambiguous chat messages are sent to the AI provider you configured — check that provider's data policy.

</details>

<details>
<summary><strong>How much does it cost?</strong></summary>

Usually **nothing**. GitHub, Supabase and Vercel free tiers are enough for one person. Optional extras: n8n is free if you self-host it (n8n Cloud is paid), Telegram is free, Resend and Sentry have free tiers, and AI OCR costs from zero (Google AI Studio free tier) to a few cents per month on paid providers.

</details>

<details>
<summary><strong>Do I need to know how to code?</strong></summary>

No. The [self-hosting guide](SELF-HOSTING.md) uses only web dashboards (GitHub, Supabase, Vercel) and copy-paste. A terminal is only needed for the optional local-development section — and even generating secrets can be done with a password manager.

</details>

<details>
<summary><strong>Can several people use it (multi-user)?</strong></summary>

Yes, for a family (schema v17 + v18). The `APP_USERNAME` login is always the **owner** and sees everything. In **Settings → Pengguna** the owner adds members with a temporary password (they must change it at first login) and picks, per wallet, **View** (balance, transactions, account report) or **Manage** (also record/edit/delete; transfers need Manage on both wallets). Members only get the dashboard, transactions, accounts and reports, computed over their wallets; gold, receivables, goals, debts, budgets, settings, the bot and the n8n API stay owner-only. Two-step login (2FA) currently protects the owner only — member 2FA is future work. Without v18, it stays a single-user app exactly as before.

</details>

<details>
<summary><strong>Can I use it without Telegram or n8n?</strong></summary>

Yes. The web app is complete on its own: manual entry, receipt OCR in the browser (if you set an AI key), CSV import, reports, reminders page, manual backup/restore. Telegram, n8n, Resend and Sentry are all optional add-ons.

</details>

<details>
<summary><strong>Does it work on my phone? Can I install it?</strong></summary>

Yes, the layout is mobile-friendly. Open your site in the phone browser → **Add to Home Screen** to get an app icon and full-screen view. It needs an internet connection (there is no offline mode).

</details>

<details>
<summary><strong>Which languages are available?</strong></summary>

Indonesian and English. Use the **ID/EN** switch in the sidebar (header on mobile); the choice is stored in your browser. The Telegram bot replies in Indonesian.

</details>

## Money, currency and time

<details>
<summary><strong>Can I change the currency?</strong></summary>

Each account, transaction and subscription is **IDR or USD** (enforced by the database). Totals and net worth are shown in IDR, converting USD with the daily exchange rate (from open.er-api.com; `FALLBACK_USD_IDR` is used only if that fails before any rate is stored). Other currencies are not supported out of the box — adding one means changing the database constraints and the formatting code.

</details>

<details>
<summary><strong>How do I change the time zone?</strong></summary>

Set `APP_TIMEZONE` in Vercel (an IANA name such as `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`, `Europe/London`) and redeploy. It decides what "today" means for new transactions, reminders, recurring items and the bot's "today" report. Default is `Asia/Jakarta`. If you use n8n, set the same zone there (`GENERIC_TIMEZONE`, `TZ`) so scheduled jobs line up.

</details>

<details>
<summary><strong>Why is an expense called "Biaya Admin", "Piutang" or "Emas" created automatically?</strong></summary>

These are linked transactions so balances stay correct: transfer/top-up/monthly account fees go to **Biaya Admin**, money lent or repaid through linked receivables to **Piutang**, and gold bought/sold from an account to **Emas**. Net worth adds outstanding receivables and gold value back, so nothing is counted twice.

</details>

<details>
<summary><strong>Kantong vs Budget: what is the difference?</strong></summary>

A **Budget** (Budget page) limits spending **per category** across all wallets, e.g. "Makan & Minuman at most 2 juta a month", with 80%/100% alerts. A **Kantong** (pocket, schema v19) splits the money **inside one wallet**, e.g. Mandiri → Makan 500rb and Transport 250rb, Cash → Parkir 100rb, without creating fake wallets. You choose the pocket on each transaction (or `#makan` in the bot); the wallet page shows what is left per pocket and how much of the balance is still unallocated (negative when you allocated more than the wallet holds). Monthly pockets start over each month; running pockets never reset. You get an alert when a pocket drops to its warning threshold or runs out. Both can be used together: a transaction can count toward a budget (its category) and a pocket (its wallet) at the same time.

</details>

## Data, backup and deletion

<details>
<summary><strong>How do I back up and restore?</strong></summary>

- **Download:** **Settings → Data backup → Download backup (JSON)** — one file with all tables.
- **Restore:** **Settings → Restore from backup** → choose the file (up to 20 MB). _Merge_ (default) updates/inserts by ID; _Replace all_ (type the confirmation word) wipes current data first. Large backups are uploaded in chunks, so Vercel's 4.5 MB request limit is not a problem.
- **Automatic:** the n8n workflow `n8n/05-dompetku-backup.json` saves a weekly backup to Google Drive (or email). See [N8N.md](N8N.md).
- Supabase's own daily backups are only on paid plans, so keep your own copies.

</details>

<details>
<summary><strong>Can I import data from another app or a spreadsheet?</strong></summary>

Yes: **Transactions → Import CSV**. Columns: date (`YYYY-MM-DD` or `DD/MM/YYYY`), type (income/expense), amount, category, account, notes, currency (IDR/USD). You get a preview; invalid rows and duplicates are skipped, and new categories/accounts are only created if you tick the option. Yearly reports can be exported as CSV from **Reports**.

</details>

<details>
<summary><strong>How do I delete everything?</strong></summary>

Options, from gentle to final:

1. **Start fresh but keep the app:** restore a backup with _Replace all_ — or, in Supabase **Table Editor**, delete rows from the tables you want to empty.
2. **Delete all data permanently:** Supabase → Project Settings → General → **Delete project**. This removes the database and receipt photos. Then delete the Vercel project (Settings → General → Delete) and, if you like, your GitHub fork (Settings → Danger Zone).

Download a backup first if you might want the data later.

</details>

<details>
<summary><strong>My Supabase project was "paused". What happened?</strong></summary>

On the **free plan**, Supabase pauses projects that have had **no activity for about a week**. While paused, the app shows database errors. Your data is **not deleted**.

- **Unpause:** Supabase dashboard → your project → **Restore project** (or _Resume_). It takes a few minutes. Paused free projects can be restored for a limited time (currently 90 days), so don't wait too long.
- **Avoid it:** use the app regularly, or let n8n do it for you — the scheduled workflow `02-dompetku-jadwal.json` calls the app (which queries the database) every day, which counts as activity. Upgrading to a paid Supabase plan also removes pausing.

</details>

## Security

<details>
<summary><strong>Someone might know my password. What do I do?</strong></summary>

With schema v17, open **Profile → Change password**: the new password is stored as a hash and every other device is signed out immediately. Without v17, change `APP_PASSWORD` **and** `SESSION_SECRET` in Vercel (changing the secret logs out every existing session), then redeploy. Consider enabling 2FA (`APP_TOTP_SECRET`, see [SELF-HOSTING §5.5](SELF-HOSTING.md#55-two-step-login-2fa)). If you think the Supabase secret key leaked, rotate it in Supabase and update `SUPABASE_SERVICE_ROLE_KEY`.

</details>

<details>
<summary><strong>I changed my password in the app and forgot it.</strong></summary>

Your hosting account is the recovery path: in Vercel set `APP_PASSWORD_RESET=true` → redeploy → log in with `APP_USERNAME` / `APP_PASSWORD` from the env → **Profile → Change password** → remove `APP_PASSWORD_RESET` → redeploy. While the switch is on the stored hash is ignored, so don't leave it on. See [ENVIRONMENT.md](ENVIRONMENT.md#password-changed-in-the-app-v17).

</details>

<details>
<summary><strong>A family member forgot their password or lost their phone.</strong></summary>

As the owner, open **Settings → Pengguna** → the key icon → set a new temporary password. All of that member's sessions end immediately, and they must choose a new password at their next login. To block someone at once, switch them to inactive or delete them; their recorded transactions stay.

</details>

<details>
<summary><strong>I lost my phone with the authenticator app.</strong></summary>

Your Vercel account is the recovery path: delete (or replace) `APP_TOTP_SECRET` in Vercel → redeploy → log in with just your password → enroll a new key.

</details>

<details>
<summary><strong>Can strangers use my Telegram bot?</strong></summary>

No. The bot **fails closed**: only chat IDs in `BOT_ALLOWED_CHAT_IDS` are served, and an empty list refuses everyone before touching the database. n8n adds a first filter with `TELEGRAM_ALLOWED_CHAT_IDS`. All automation endpoints also require your `N8N_API_KEY`.

</details>

<details>
<summary><strong>What is privacy mode?</strong></summary>

The eye icon (or **Shift + H**) hides every amount, balance, chart value and gold weight on that device — useful in public or when screen-sharing. It's a per-device display setting, not encryption; percentages and counts stay visible, and exports and the bot are not masked.

</details>

## Bot and AI

<details>
<summary><strong>Do I need an AI key? Which provider should I use?</strong></summary>

Only for **receipt OCR** and understanding **ambiguous chat messages**. Simple messages like "kopi 25rb" are parsed without AI. Any OpenAI-compatible endpoint works; Google Gemini (`gemini-2.5-flash`) via AI Studio is a good free starting point. Examples: [SELF-HOSTING §6.2](SELF-HOSTING.md#62-receipt-ocr-and-ai-chat-parsing). Set `BOT_TEXT_AI=never` to use zero AI tokens for chat.

</details>

<details>
<summary><strong>Can the AI create wrong categories or save things without asking?</strong></summary>

No. AI output is snapped onto your **existing** categories and accounts (falling back to "Lainnya"); it never creates new ones. Every bot entry is shown as a **preview** and is saved only when you tap ✅ — double taps and retries don't create duplicates, and `/undo` removes the last bot transaction.

</details>

<details>
<summary><strong>Does it support WhatsApp?</strong></summary>

Not out of the box. The bot endpoint (`POST /api/public/n8n/bot`) returns plain text plus Telegram-style buttons, and the provided n8n workflows target Telegram. Simpler endpoints (`/message`, `/ocr`, `/command`, `/reminders`) return a ready-to-send `message`, so a WhatsApp flow in n8n is possible but you'd build it yourself.

</details>

## Technical

<details>
<summary><strong>What is the tech stack?</strong></summary>

TanStack Start (React 19, server functions) built with Vite and Nitro, Tailwind CSS + shadcn/ui, Supabase (Postgres + Storage) via a server-only client, deployed on Vercel (or Lovable). Tests use Vitest. Details: [ARCHITECTURE.md](ARCHITECTURE.md).

</details>

<details>
<summary><strong>Can I host somewhere other than Vercel?</strong></summary>

The build targets Vercel when the `VERCEL` variable is set and Lovable's runtime otherwise (`vite.config.ts`). Other hosts (Netlify, Cloudflare, a Node server/Docker) would need a different Nitro preset in `vite.config.ts` — possible, but not tested or documented here. Contributions welcome.

</details>

<details>
<summary><strong>Do I have to re-run the database schema after updating?</strong></summary>

Yes, it's the safe habit: after syncing your fork, paste the latest `supabase/schema.sql` into the Supabase SQL Editor and run it. The file is idempotent — it only adds what is missing and never deletes data. Until a new section is run, related features show a hint and the rest of the app keeps working.

</details>

<details>
<summary><strong>Why is the app slow?</strong></summary>

Almost always a **region mismatch**: the Vercel function region (`vercel.json` → `regions`, default `sin1` Singapore) must be close to your Supabase region. Also run the full schema — section v9 moves report sums into Postgres, which makes dashboards faster.

</details>

<details>
<summary><strong>How do I contribute or report a bug?</strong></summary>

See [CONTRIBUTING.md](../CONTRIBUTING.md). For security issues, follow [SECURITY.md](../SECURITY.md) instead of opening a public issue. Never paste keys, URLs of your instance, or personal financial data into issues.

</details>
