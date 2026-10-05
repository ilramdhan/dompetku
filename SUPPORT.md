# Getting help

Stuck while installing or using Dompetku? Here is where to look, in order.

## 1. Read the docs first

Most questions are already answered here:

| Document                                     | Covers                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| [FAQ](docs/FAQ.md)                           | Common questions and quick fixes                            |
| [Self-hosting guide](docs/SELF-HOSTING.md)   | Step-by-step installation, updating and **troubleshooting** |
| [Environment variables](docs/ENVIRONMENT.md) | What every setting means and which ones are required        |
| [n8n & Telegram bot](docs/N8N.md)            | Bot, reminders, email and Google Drive backups              |
| [Architecture](docs/ARCHITECTURE.md)         | How the code is organised (for developers)                  |

> [!TIP]
> Many problems after an update are fixed by running the newest section of [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor, then redeploying.

## 2. Search existing issues

Someone may have had the same problem: [search open and closed issues](https://github.com/ilramdhan/dompetku/issues?q=is%3Aissue).

## 3. Ask a question

[Open a new issue](https://github.com/ilramdhan/dompetku/issues/new/choose) and choose **Question**. Tell us what you tried, what you expected and what happened instead.

> [!WARNING]
> Issues are public. **Remove secrets before posting**: API keys, passwords, `SESSION_SECRET`, Supabase keys, Telegram bot tokens, chat IDs, your domain and your financial data.

## Other channels

| You want to…                    | Go to                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Report a bug                    | [Bug report form](https://github.com/ilramdhan/dompetku/issues/new?template=bug_report.yml)           |
| Suggest a feature               | [Feature request form](https://github.com/ilramdhan/dompetku/issues/new?template=feature_request.yml) |
| Report a security vulnerability | **Privately**, see [SECURITY.md](SECURITY.md) — never in a public issue                               |
| Contribute code or docs         | [CONTRIBUTING.md](CONTRIBUTING.md)                                                                    |

Dompetku is maintained by one person in their free time, so answers may take a few days. Please be patient and kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
