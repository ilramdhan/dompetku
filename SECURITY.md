# Security Policy

Dompetku stores personal financial data, so security reports are taken seriously. Thank you for helping keep self-hosters safe.

## Supported versions

Dompetku is a self-hosted app without numbered releases. Only the latest code on the **`main`** branch receives security fixes.

| Version                 | Supported                                                                         |
| ----------------------- | --------------------------------------------------------------------------------- |
| `main` (latest commit)  | ✅                                                                                |
| Older commits and forks | ❌ — please update (see [Updating in docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)) |

## Reporting a vulnerability

> [!IMPORTANT]
> **Please do not open a public issue, discussion or pull request for security problems.** Public reports put every self-hoster at risk before a fix exists.

Report privately through GitHub:

1. Go to the repository's [**Security** tab](https://github.com/ilramdhan/dompetku/security).
2. Click **Report a vulnerability** (or open [this link directly](https://github.com/ilramdhan/dompetku/security/advisories/new)).
3. Describe the issue. Helpful details:
   - what an attacker can do (impact),
   - steps to reproduce or a proof of concept,
   - affected file(s), route(s) or commit,
   - your deployment type (Vercel, Lovable, local) if relevant.

Only you and the maintainer can see the report. **Never include real secrets, tokens or personal financial data** — use placeholders.

### What to expect

| Step                                   | Target time                                          |
| -------------------------------------- | ---------------------------------------------------- |
| Acknowledgement of your report         | within 7 days                                        |
| Initial assessment (valid / severity)  | within 14 days                                       |
| Fix or mitigation for confirmed issues | depends on severity; critical issues are prioritised |
| Public advisory                        | after a fix is available on `main`                   |

This is a hobby project maintained by one person, so these are good-faith targets, not guarantees. You will be credited in the advisory unless you prefer to stay anonymous. There is no bug bounty.

## Scope

**In scope** — code in this repository:

- Authentication and sessions (login, TOTP two-step login, session cookie, login throttling)
- Authorization of server functions (`requireAuth`) and of the public automation routes under `/api/public/n8n/*` (`N8N_API_KEY`)
- The Telegram bot endpoint and its chat allow-list (`BOT_ALLOWED_CHAT_IDS`)
- Data exposure: anything that lets the browser or a third party read the database, receipt photos or backups without authorization
- Injection, XSS, CSRF, SSRF, path traversal, unsafe file uploads (receipt photos), backup/restore abuse
- The n8n workflow templates in `n8n/` and the SQL in `supabase/schema.sql`

**Out of scope:**

- Vulnerabilities in third-party services or libraries themselves (Supabase, Vercel, Lovable, n8n, Telegram, Google, your AI provider) — report those upstream. A vulnerable _dependency version_ used by Dompetku is in scope.
- Problems caused by a misconfigured self-hosted instance (weak password, leaked keys, disabled RLS) — see the hardening checklist below.
- Attacks requiring physical access to an unlocked device, or a compromised hosting/Supabase account.
- Missing best-practice headers or rate limits without a demonstrated impact, denial of service by flooding, social engineering, spam.

## Hardening checklist for self-hosters

Dompetku is a **single-user** app: whoever knows the login can see all your finances. Please go through this list after installing. Every variable is explained in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

**Login**

- [ ] `APP_PASSWORD` is long and unique (a password manager-generated passphrase of 16+ characters). Don't reuse it anywhere else.
- [ ] `SESSION_SECRET` is a random string of **at least 32 characters** (the app refuses to start sessions with less). Generate one with `openssl rand -hex 32`. Changing it logs out every session.
- [ ] Two-step login is enabled: set `APP_TOTP_SECRET` (the **Settings** page has a "Two-step verification (2FA)" card that helps you enroll) and scan it with an authenticator app.

**Database (Supabase)**

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is **only** stored in your hosting provider's environment variables (Vercel/Lovable) and your local `.env`. Never commit it, paste it into chats or screenshots, or put it in any variable that reaches the browser. It bypasses all database security.
- [ ] Row Level Security stays **enabled** on every table (the schema turns it on with no policies — that is intentional; the app only talks to the database from the server). Don't add public policies and don't disable RLS.
- [ ] The `receipts` storage bucket stays **private**. Photos are only shown through short-lived signed URLs.
- [ ] Your Supabase account uses a strong password and multi-factor authentication.

**Automation (n8n + Telegram)**

- [ ] `N8N_API_KEY` is a long random string (`openssl rand -hex 32`), identical in the app and in n8n, and rotated if it may have leaked (change it in both places, then redeploy).
- [ ] `BOT_ALLOWED_CHAT_IDS` contains **only your own** Telegram chat ID(s). Leaving it empty blocks every chat — never try to "open it up" for convenience.
- [ ] Your Telegram bot token is kept secret; if it leaks, revoke it with [@BotFather](https://t.me/BotFather) (`/revoke`).
- [ ] Your n8n instance is protected by a login and served over HTTPS.

**Backups**

- [ ] Backup files contain your complete financial history in plain JSON. Keep the Google Drive folder used by the backup workflow **private** (not "anyone with the link"), and protect the Google account with 2-step verification. Google Drive encrypts files at rest, but anyone with access to the folder can read them.
- [ ] Downloaded backups on your computer are stored somewhere safe (e.g. an encrypted disk) and deleted when no longer needed.

**General**

- [ ] Keep your fork up to date with `main` to receive security fixes.
- [ ] **Never set `DEMO_MODE=true` on an instance with real data.** Demo mode publishes the login credentials on the login page and disables 2FA. Run a public demo only as a separate deployment with its own empty Supabase project (see [docs/DEMO.md](docs/DEMO.md)).
- [ ] Rotate any key you suspect was exposed: Supabase service-role key (Supabase dashboard → Project Settings → API), `AI_API_KEY`, `RESEND_API_KEY`, `N8N_API_KEY`, `SESSION_SECRET`.
- [ ] When sharing logs or screenshots in issues, redact keys, chat IDs, domains and amounts.
