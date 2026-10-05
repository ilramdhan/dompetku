# Contributing to Dompetku

First of all: thank you! 🎉 Dompetku is a personal finance tracker (web app + Telegram bot via n8n + receipt OCR) and every contribution helps — whether it is a typo fix, a translation, a bug report or a whole new feature.

This guide is written for **first-time contributors** as well as experienced developers. If anything here is unclear, that is a bug in this document — please [open a question](https://github.com/ilramdhan/dompetku/issues/new/choose) and we will improve it.

> [!NOTE]
> By participating in this project you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Your first contribution, step by step](#your-first-contribution-step-by-step)
- [Project rules (the short version)](#project-rules-the-short-version)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Releases](#releases)
- [AI-assisted contributions](#ai-assisted-contributions)
- [Labels](#labels)
- [Licensing](#licensing)

## Ways to contribute

| What                         | How                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐛 **Report a bug**          | Use the [bug report form](https://github.com/ilramdhan/dompetku/issues/new?template=bug_report.yml). Please search existing issues first.                                                                                                                                                             |
| 💡 **Suggest a feature**     | Use the [feature request form](https://github.com/ilramdhan/dompetku/issues/new?template=feature_request.yml). Explain the problem you want solved, not only the solution.                                                                                                                            |
| 📖 **Improve the docs**      | Everything in `docs/`, `README.md` and `n8n/README.md` is fair game. Small doc fixes can go straight to a pull request.                                                                                                                                                                               |
| 🌐 **Translations (ID/EN)**  | The app supports Indonesian and English. All UI text lives in the `DICT` dictionary in [`src/lib/i18n.tsx`](src/lib/i18n.tsx). The **key** is the original Indonesian text, the **value** is the English translation. Fixing awkward English or adding missing entries is a great first contribution. |
| ✨ **Build a feature / fix** | Pick an issue (look for `good first issue` or `help wanted`), comment that you are working on it, then follow the walkthrough below. For bigger changes please open an issue first so we can agree on the approach.                                                                                   |

> [!WARNING]
> **Security problems are not reported in public issues.** Please follow [SECURITY.md](SECURITY.md) instead.

## Your first contribution, step by step

Never made a pull request before? No problem. A _pull request_ (PR) is a way of saying "here are some changes, please review and merge them".

### 1. Fork and clone

1. Click **Fork** (top-right of the [repository page](https://github.com/ilramdhan/dompetku)). This makes your own copy of the project on GitHub.
2. Clone your fork to your computer (replace `<your-username>`):

   ```sh
   git clone https://github.com/<your-username>/dompetku.git
   cd dompetku
   git remote add upstream https://github.com/ilramdhan/dompetku.git
   ```

   `upstream` points at the original repository so you can pull in new changes later.

### 2. Create a branch

Never work directly on `main`. Create a branch named after what you are doing:

| Prefix      | Use for                               | Example                        |
| ----------- | ------------------------------------- | ------------------------------ |
| `feat/`     | New features                          | `feat/export-pdf`              |
| `fix/`      | Bug fixes                             | `fix/budget-rollover-rounding` |
| `docs/`     | Documentation only                    | `docs/faq-telegram`            |
| `chore/`    | Tooling, dependencies, CI             | `chore/bump-vitest`            |
| `refactor/` | Code changes with no behaviour change | `refactor/split-helpers`       |
| `test/`     | Tests only                            | `test/fees-edge-cases`         |

```sh
git checkout -b fix/budget-rollover-rounding
```

### 3. Set up the project locally

Follow **[Running locally in docs/SELF-HOSTING.md](docs/SELF-HOSTING.md#7-running-locally-for-developers)** — it explains how to install the tools, create a free Supabase project and fill in `.env`.

The project uses [Bun](https://bun.sh) in CI, but npm works too:

| Task                   | Bun                 | npm                 |
| ---------------------- | ------------------- | ------------------- |
| Install dependencies   | `bun install`       | `npm install`       |
| Start the dev server   | `bun run dev`       | `npm run dev`       |
| Run unit tests         | `bun run test`      | `npm test`          |
| Lint                   | `bun run lint`      | `npm run lint`      |
| Type-check             | `bun run typecheck` | `npm run typecheck` |
| Production build       | `bun run build`     | `npm run build`     |
| Format code (Prettier) | `bun run format`    | `npm run format`    |

> [!TIP]
> Many changes (pure helpers, translations, docs) can be developed and tested with `bun run test` alone — you don't need a Supabase project for those.

### 4. Make your change

- Keep it focused: one bug or one feature per PR.
- Add or update tests in `src/test/` for any pure logic you touch.
- Read the [project rules](#project-rules-the-short-version) below before changing server code or the database.

### 5. Check everything passes

Before pushing, run the same four checks CI runs:

```sh
bun run lint && bun run typecheck && bun run test && bun run build
```

### 6. Commit, push and open the PR

```sh
git add <files>
git commit -m "fix(budget): round rollover carry to whole rupiah"
git push -u origin fix/budget-rollover-rounding
```

GitHub will show a **Compare & pull request** button. Fill in the template — it is a checklist that helps you (and the reviewer) not forget anything.

### Keeping your branch up to date

```sh
git fetch upstream
git rebase upstream/main   # only on your own branch that nobody has reviewed yet
```

## Project rules (the short version)

The full, authoritative list lives in [`AGENTS.md`](AGENTS.md) and the architecture is explained in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The most important rules:

**Data and security**

- **The browser never talks to Supabase directly.** All database access happens in server code through the service-role client in `src/lib/db.server.ts`. Row Level Security stays **on** with no policies.
- **Every data server function uses the `requireAuth` middleware.** External automation (n8n) only uses `/api/public/n8n/*` routes guarded by `N8N_API_KEY`.
- Business logic lives in `src/lib/finance.server.ts` (and friends) so the web app and the Telegram bot share it.
- Server errors go through `logError()` (`src/lib/monitoring.server.ts`).

**Database changes**

- The schema is in [`supabase/schema.sql`](supabase/schema.sql). Self-hosters run it on their own Supabase, so:
  - **Never edit an old section.** Append a new numbered section (`-- ============ vN: ... ============`) after the last one.
  - Every statement must be **idempotent** (safe to run twice): `create table if not exists`, `add column if not exists`, `create or replace function`, etc.
  - Add new tables/columns to `src/lib/database.types.ts` (mark columns optional when the section might not be run yet).
  - Add new tables to `RESTORE_TABLES` in `src/lib/backup.ts` in foreign-key order so backup/restore covers them.
  - **Degrade gracefully:** reads of optional tables go through `isMissingTable()` (and SQL functions through `isMissingFunction()`), so pages never crash for users who haven't run the new section yet.
  - Document the new section in the setup docs.

**UI**

- **Mobile-first.** Check your change on a narrow phone screen as well as desktop.
- **Colors use semantic tokens only** (e.g. `bg-card`, `text-muted-foreground`) so light and dark mode both work. No hard-coded hex colors.
- **All UI text is wrapped in `t(...)`** and registered in `DICT` in `src/lib/i18n.tsx` (key = Indonesian text, value = English).
- **Money is formatted with `money()` / `compact()`** and components showing amounts call `usePrivacy()` so privacy mode can mask them.
- After create/update/delete, invalidate with `invalidateFor(qc, table)` — never a blanket `invalidateQueries()`.
- **No service worker.** The PWA is manifest-only on purpose.

**Tests**

- Pure, client-safe helpers (parsing, math, formatting) live in their own modules under `src/lib/` and get unit tests in `src/test/` with [Vitest](https://vitest.dev).

**Environment variables**

- New env vars must be optional where possible, added to `.env.example` and documented in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): short description` in the imperative mood, lower case, no trailing period.

| Type       | When                                    |
| ---------- | --------------------------------------- |
| `feat`     | A new feature                           |
| `fix`      | A bug fix                               |
| `docs`     | Documentation only                      |
| `test`     | Adding or fixing tests                  |
| `perf`     | Performance improvement                 |
| `refactor` | Code change that neither fixes nor adds |
| `style`    | Formatting only                         |
| `chore`    | Tooling, dependencies                   |
| `ci`       | CI configuration                        |

Examples taken from this repository's history:

```text
feat(bot): append budget 80%/100% alerts to the saved-transaction reply
fix(goals): use the source account's currency for goal transfers
perf: lazy-load recharts charts and add route skeletons
docs: document optional APP_TOTP_SECRET two-step login
feat(db): schema v13 dk_account_monthly function and account_reconciliations table
```

Several small, logical commits are better than one giant commit.

## Pull request process

1. **Keep PRs small.** Under ~400 changed lines is easy to review; split larger work into several PRs.
2. **Fill in the PR template** and link the issue (`Closes #123`).
3. **CI must be green.** GitHub Actions runs lint, typecheck, test and build on every PR. If it fails, click **Details** next to the failing check to see why.
4. **Add screenshots** for UI changes (mobile + desktop, light + dark).
5. **Review.** The maintainer aims to respond within about a week. Expect questions or change requests — that's normal and not a rejection. Reply to each comment or push a fix.
6. **Don't force-push after review has started.** Add new commits instead so the reviewer can see what changed; the PR is squashed or merged at the end anyway.

> [!NOTE]
> **About rebasing and Lovable.** The maintainer's `main` branch is connected to [Lovable](https://lovable.dev), so _published_ history on that branch must never be rewritten (no force pushes there). For contributors this only means: feel free to rebase or amend **your own branch while nobody has reviewed it yet**, but never rewrite commits that are already on `main` or that a reviewer is looking at.

### Before you request a review

- [ ] `lint`, `typecheck`, `test` and `build` pass locally
- [ ] New pure logic has tests
- [ ] Schema changes are a new idempotent `vN` section + `database.types.ts` + `backup.ts`
- [ ] New env vars are in `.env.example` and `docs/ENVIRONMENT.md`
- [ ] New UI text uses `t(...)` and has an English entry
- [ ] Docs updated if behaviour changed
- [ ] No secrets, personal data or real API keys in code, screenshots or logs

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please): your **PR title** (used as the squash-merge commit) decides whether the change shows up in the changelog and how the version is bumped — `fix` → patch, `feat` → minor, `!`/`BREAKING CHANGE` → major. You don't need to touch `package.json` `version` or `CHANGELOG.md` versioned entries; the maintainer merges the generated Release PR. Details: [`docs/RELEASING.md`](docs/RELEASING.md).

## AI-assisted contributions

Using AI coding assistants (Claude Code, Copilot, Cursor, Lovable, …) is welcome. [`AGENTS.md`](AGENTS.md) is the instruction file for coding agents — point your agent at it so it follows the same rules. Claude Code reads [`CLAUDE.md`](CLAUDE.md), which imports `AGENTS.md` and adds the day-to-day workflow (commands, UI checklist, commit/PR conventions). You remain responsible for what you submit: read and understand the code, run the checks, and make sure tests are meaningful.

## Labels

Issues and PRs use these labels (the maintainer manages them):

| Label              | Meaning                                       |
| ------------------ | --------------------------------------------- |
| `bug`              | Something is broken                           |
| `enhancement`      | New feature or improvement                    |
| `documentation`    | Docs only                                     |
| `question`         | Help or clarification                         |
| `good first issue` | Small, well-scoped — great for newcomers      |
| `help wanted`      | The maintainer would love a contribution here |
| `dependencies`     | Dependency updates (Dependabot)               |
| `needs-triage`     | Not yet reviewed by the maintainer            |

## Licensing

- Dompetku is released under the [MIT License](LICENSE). By submitting a contribution you agree that it is licensed under the same MIT License. No CLA and no DCO sign-off are required.
- Third-party assets keep their own licenses:
  - The self-hosted fonts in `public/fonts` (Bricolage Grotesque, Figtree, JetBrains Mono) are licensed under the **SIL Open Font License 1.1** — see [`public/fonts/LICENSE-OFL.txt`](public/fonts/LICENSE-OFL.txt).
  - The UI components in `src/components/ui` are based on [shadcn/ui](https://ui.shadcn.com) (MIT).

Thank you for helping make Dompetku better! 💚
