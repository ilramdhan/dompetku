# n8n workflow templates

Ready-to-import [n8n](https://n8n.io) workflows for Dompetku: the Telegram bot, scheduled reminders/reports, error alerts and weekly backups. n8n is only a thin relay; all logic lives in the web app (`/api/public/n8n/*`, protected by the `x-api-key` header = `N8N_API_KEY`).

> [!IMPORTANT]
> **Full step-by-step guide: [docs/N8N.md](../docs/N8N.md)** (hosting n8n, env vars, credentials, Telegram bot, Google Drive OAuth, Gmail/Resend email, troubleshooting).

| File                                  | Purpose                                                                                                                                                         | Env vars (n8n)                                                    | Credentials                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `01-dompetku-telegram-bot.json`       | Main bot: chat, receipt photos, `/` commands, inline buttons                                                                                                    | `FINTRACK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS` | Telegram API, Header Auth `x-api-key`      |
| `02-dompetku-jadwal.json`             | Bill reminders 08:00, daily recap 21:00, weekly (Mon) & monthly (1st) reports → Telegram                                                                        | `FINTRACK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`    | Header Auth `x-api-key`                    |
| `03-dompetku-error-handler.json`      | Telegram alert when a workflow fails (set as _Error workflow_ of 01, 02, 05)                                                                                    | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`                    | —                                          |
| `04-dompetku-setup-commands.json`     | Run once: registers the `/` command menu and shows webhook info                                                                                                 | `TELEGRAM_BOT_TOKEN`                                              | —                                          |
| `05-dompetku-backup.json`             | Weekly backup (Sun 02:00) → Google Drive, or email attachment (disabled node)                                                                                   | `FINTRACK_URL` (+ `BACKUP_EMAIL_FROM`, `BACKUP_EMAIL_TO`)         | Header Auth, Google Drive OAuth2 (or SMTP) |
| `06-dompetku-notifikasi-anggota.json` | Optional alternative to 02: same schedules, one message per recipient — owner (all wallets) + family members (their wallets only, schema v22). Use 02 **or** 06 | `FINTRACK_URL`, `TELEGRAM_BOT_TOKEN`                              | Header Auth                                |

Quick start:

1. Set the env vars above in n8n plus `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, then restart n8n.
2. **Workflows → Import from File** for each JSON.
3. Replace every `REPLACE_ME` credential (and `REPLACE_ME_FOLDER_ID` in 05), save, and activate.

Node names inside the workflows are in Indonesian (e.g. _Ambil backup_ = "fetch backup", _Kirim via email_ = "send via email"); sticky notes are in English.
