# Environment variables

Every setting Dompetku reads from its environment. New to this? An **environment variable** is a named setting (like `APP_PASSWORD`) that you give to the server instead of writing it into the code — so your secrets never end up on GitHub.

**Where to set them**

| Place                          | How                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vercel** (production)        | Project → **Settings → Environment Variables** → add Key/Value → then **Deployments → ⋯ → Redeploy**. Changes only apply after a redeploy. |
| **Local `.env`** (development) | `cp .env.example .env`, fill in values. Never commit `.env`.                                                                               |
| **n8n**                        | Environment of the n8n container/process (e.g. `docker-compose.yml`). See [n8n variables](#n8n-variables) and [N8N.md](N8N.md).            |

> [!WARNING]
> All app variables are **server-only**. None of them start with `VITE_`, so none are ever sent to the browser. Keep it that way — never rename a secret to `VITE_…`.

Step-by-step setup: [SELF-HOSTING.md](SELF-HOSTING.md). Template: [`.env.example`](../.env.example).

## Required

| Name                        | Example                                       | What it does                                                                                                         | How to obtain                                                                               | Security                                                                                                        |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | `https://your-project-ref.supabase.co`        | Address of your Supabase database API.                                                                               | Supabase → Project Settings → Data API → Project URL.                                       | Not secret on its own.                                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` or `eyJ…` (legacy service_role) | Server key used for **all** database and Storage access. RLS is on with no policies, so only this key can read data. | Supabase → Project Settings → API Keys → Secret key (or Legacy → `service_role`).           | **Highly sensitive** — full database access. Never in browser, logs, screenshots. Rotate in Supabase if leaked. |
| `APP_USERNAME`              | `me`                                          | The single login username.                                                                                           | Choose it.                                                                                  | Treat as private.                                                                                               |
| `APP_PASSWORD`              | `<long random password>`                      | The single login password (compared in constant time; 8 failed attempts per 15 min lock login).                      | Password manager.                                                                           | **Secret.** Use a long unique password.                                                                         |
| `SESSION_SECRET`            | `<openssl rand -base64 48>`                   | HMAC key that signs the login cookie (valid 7 days). **Must be ≥ 32 characters**, otherwise login fails.             | `openssl rand -base64 48` (see [SELF-HOSTING §3](SELF-HOSTING.md#3-generate-your-secrets)). | **Secret.** Changing it logs everyone out.                                                                      |

## Automation (n8n)

| Name          | Required?                                                 | Example                     | What it does                                                                                                                                                                                       | Security                                                                                                                                     |
| ------------- | --------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `N8N_API_KEY` | For bot, reminders, backups, any `/api/public/n8n/*` call | `<openssl rand -base64 48>` | Shared key that n8n sends in the `x-api-key` header (or `Authorization: Bearer`). **Must be ≥ 24 characters**; empty/shorter makes every n8n endpoint answer **503**, a wrong value gives **401**. | **Secret.** Same value goes into the n8n _Header Auth_ credential. The backup endpoint returns all your data, so protect it like a password. |

## Login 2FA (optional)

| Name              | Example                                  | What it does                                                                                                                                   | How to obtain                                                           | Security                                                                                 |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `APP_TOTP_SECRET` | `JBSWY3DPEHPK3PXP…` (base32, ≥ 16 chars) | Enables a 6-digit authenticator code after the password. Empty = password-only. An invalid value is ignored (2FA off) and flagged in Settings. | App → **Settings → Two-step verification (2FA) → Generate secret key**. | **Secret.** Keep a backup in your password manager. Removing it + redeploy disables 2FA. |

## AI: receipt OCR and chat parsing (optional)

| Name              | Default                                    | Example                                                                    | What it does                                                                                                                     |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AI_API_URL`      | Lovable AI gateway (only works on Lovable) | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | Full URL of an **OpenAI-compatible chat-completions** endpoint. Must end in `/chat/completions`. Set it on Vercel.               |
| `AI_API_KEY`      | —                                          | `<provider API key>`                                                       | Sent as `Authorization: Bearer …`. Without it, OCR and AI parsing return an error (non-AI chat parsing still works). **Secret.** |
| `AI_MODEL`        | `google/gemini-2.5-flash`                  | `gemini-2.5-flash`, `gpt-4o-mini`                                          | Model for receipt photos — must support images (vision). Name format depends on the provider.                                    |
| `AI_MODEL_TEXT`   | value of `AI_MODEL`                        | `gemini-2.5-flash-lite`                                                    | Cheaper model for parsing ambiguous chat messages.                                                                               |
| `LOVABLE_API_KEY` | —                                          | —                                                                          | Set automatically by Lovable; used as the key when `AI_API_KEY` is empty. Don't set it on Vercel.                                |

Provider examples (Gemini, OpenAI, OpenRouter, Ollama): [SELF-HOSTING §6.2](SELF-HOSTING.md#62-receipt-ocr-and-ai-chat-parsing).

## Telegram bot (optional)

| Name                   | Required?                   | Example                       | What it does                                                                                                                                                                                     |
| ---------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BOT_ALLOWED_CHAT_IDS` | **Yes, if you use the bot** | `123456789,987654321`         | Comma-separated Telegram chat IDs allowed to use the bot. **Fails closed:** empty = every chat is refused before any database access, and the bot replies with the chat ID to add.               |
| `BOT_DEFAULT_ACCOUNT`  | No                          | `BCA`                         | Account name used when a message doesn't mention one. Must match an existing account name. Can be overridden in Settings → App (v14).                                                            |
| `BOT_TEXT_AI`          | No (default `auto`)         | `auto` \| `always` \| `never` | When chat messages may use AI: only when ambiguous, always, or never (zero AI tokens for chat; receipts still use AI).                                                                           |
| `BOT_AI_DAILY_LIMIT`   | No (default `50`)           | `50` \| `0`                   | Max bot AI calls (chat parsing + photo OCR) per chat per app-local day; the bot then asks for the quick format. `0` = unlimited. Counted in `ai_usage` (v15); without it, today's AI/OCR drafts. |

## Regional (optional)

| Name               | Default        | Example                          | What it does                                                                                                                                                                                |
| ------------------ | -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_TIMEZONE`     | `Asia/Jakarta` | `Asia/Makassar`, `Europe/Berlin` | IANA time zone that defines "today" for new transactions, reminders, reports and recurring items. Use the same zone in n8n (`GENERIC_TIMEZONE`). Can be overridden in Settings → App (v14). |
| `FALLBACK_USD_IDR` | `16000`        | `16250`                          | USD→IDR rate used only when the live rate API (open.er-api.com) fails **and** no rate is stored yet.                                                                                        |

> **Settings override (v14).** After running the v14 section of `supabase/schema.sql`, Settings → **Aplikasi** stores the app name, tagline, logo, time zone, base currency (display preference only — totals stay in IDR), landing page toggle, bot default account and default reminder days in the single-row `app_settings` table. Values set there win over `APP_TIMEZONE` / `BOT_DEFAULT_ACCOUNT`; empty fields (or a missing table) fall back to these env vars and built-in defaults. Changes apply within ~60 s per server instance.

## Email reminders via Resend (optional)

All three are needed for `POST /api/public/n8n/reminders-send-email`. Not needed if n8n sends email itself.

| Name             | Example                               | What it does                                                             | How to obtain                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `RESEND_API_KEY` | `re_…`                                | Resend API key. **Secret.**                                              | <https://resend.com> → API Keys.                               |
| `EMAIL_FROM`     | `Dompetku <noreply@mail.example.com>` | Sender; the domain must be verified in Resend.                           | Resend → Domains → add DNS records your domain provider shows. |
| `EMAIL_TO`       | `you@example.com`                     | Default recipient(s), comma-separated. A request body `to` overrides it. | —                                                              |

## Monitoring (optional)

| Name         | Example                                          | What it does                                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN` | `https://<key>@o000000.ingest.sentry.io/0000000` | Also sends server errors to Sentry (plain fetch, 3 s timeout, never fails a request). Without it errors are still logged as one JSON line in Vercel Logs. From Sentry → Project Settings → Client Keys (DSN). Not highly secret, but keep it private to avoid spam events. |

## Public demo (optional)

See [DEMO.md](DEMO.md).

| Name              | Example                               | What it does                                                                                                                                                                                                                                           | Security                                                                                                      |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`       | `true` (only on a demo instance)      | Turns the instance into a **public demo**: shows `APP_USERNAME`/`APP_PASSWORD` on the login page with one-click sign-in, ignores 2FA, disables AI/uploads/import/restore/settings/n8n routes, caps rows and rate-limits writes. Any other value = off. | **Never** on an instance with real data — it publishes the login. Use a separate, throwaway Supabase project. |
| `PUBLIC_DEMO_URL` | `https://demo.dompetku.ilramdhan.dev` | On your **main** instance: shows a **Coba demo** button (navbar, hero, final CTA) linking to a public demo. Must be `https://`; empty = hidden.                                                                                                        | Not secret.                                                                                                   |

## Development only

| Name                  | Where                  | What it does                                                                                                                |
| --------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_RESET_CONFIRM`  | GitHub Actions / shell | Must be `yes` (plus `--allow-remote`) before `scripts/seed-demo.mjs` touches a non-local database. Set by `demo-reset.yml`. |
| `SUPABASE_PROJECT_ID` | local shell / `.env`   | Project ref (the `abcdefghijkl` in your Supabase URL) for `bun run gen:types`. Not used by the app; don't set it on Vercel. |

## Set by the platform (don't set these)

| Name                    | Set by        | Used for                                                           |
| ----------------------- | ------------- | ------------------------------------------------------------------ |
| `VERCEL`                | Vercel builds | `vite.config.ts` switches the build target to Vercel when present. |
| `VERCEL_ENV`            | Vercel        | `environment` tag on Sentry events.                                |
| `VERCEL_GIT_COMMIT_SHA` | Vercel        | `release` tag on Sentry events.                                    |
| `NODE_ENV`              | runtime       | Fallback `environment` tag for Sentry.                             |

## n8n variables

These live in the **n8n** environment (not Vercel) and are read by the workflow templates in [`n8n/`](../n8n) via `$env.…`. n8n must allow it: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Full setup: [N8N.md](N8N.md).

| Name                        | Used by            | Example                       | What it does                                                                                               |
| --------------------------- | ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `FINTRACK_URL`              | 01, 02, 05         | `https://your-app.vercel.app` | Base URL of your Dompetku deployment (no trailing slash).                                                  |
| `TELEGRAM_BOT_TOKEN`        | 01, 02, 03, 04     | `<token from @BotFather>`     | Telegram Bot API token. **Secret.**                                                                        |
| `TELEGRAM_ALLOWED_CHAT_IDS` | 01                 | `123456789`                   | Comma-separated chat IDs n8n forwards to the app (first filter; the app re-checks `BOT_ALLOWED_CHAT_IDS`). |
| `TELEGRAM_ADMIN_CHAT_ID`    | 02, 03             | `123456789`                   | Chat that receives scheduled reminders/reports and workflow error alerts.                                  |
| `BACKUP_EMAIL_FROM`         | 05 (email variant) | `noreply@mail.example.com`    | Sender for emailed backups.                                                                                |
| `BACKUP_EMAIL_TO`           | 05 (email variant) | `you@example.com`             | Recipient for emailed backups.                                                                             |

The `N8N_API_KEY` value is **not** an n8n environment variable — it goes into an n8n **Header Auth credential** (Name `x-api-key`).
