# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.
The authoritative architecture rules live in `AGENTS.md` and are imported below —
keep rules there, not here, so there is a single source of truth.

@AGENTS.md

## Project at a glance

Dompetku (repo `dompetku`, formerly `fintrack`) is a single-user personal finance tracker: web app +
Telegram bot (forwarded by n8n) + receipt OCR. Stack: TanStack Start (React 19,
TanStack Router/Query), Tailwind CSS 4 + shadcn/ui, Supabase (Postgres + Storage,
server-side only), Vitest. Deployed on Lovable and Vercel from the same code.

| Path                          | What lives there                                                    |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/routes/_app/*`           | Authenticated pages (dashboard, transactions, reports, …)           |
| `src/routes/api/public/n8n/*` | `N8N_API_KEY`-guarded automation endpoints                          |
| `src/lib/*.server.ts`         | Server-only code (DB, AI, email, bot). Never import from the client |
| `src/lib/*.functions.ts`      | `createServerFn` wrappers (with `requireAuth`)                      |
| `src/lib/*.ts` (no suffix)    | Pure, client-safe helpers — unit-tested in `src/test/`              |
| `src/components/`             | Shared UI; `ui/` is shadcn, `charts/` are lazy Recharts wrappers    |
| `supabase/schema.sql`         | Idempotent, append-only `vN` schema sections                        |
| `docs/`                       | Architecture, self-hosting, env vars, n8n, demo, releasing          |

## Commands

```sh
npm run dev         # dev server
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest run (src/test/**)
npm run build       # production build
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build — run all four
before committing; keep them green.

## Working conventions

- **Don't break what works.** Prefer small, additive changes; reuse existing helpers
  (`Pagination`, `money()`, `invalidateFor`, `isMissingTable`, …) before adding new ones.
- **Pure logic first.** Put math/parsing/formatting in a client-safe `src/lib/*.ts`
  module with a Vitest test; keep components and `*.server.ts` thin.
- **UI checklist:** mobile-first (check a ~375 px viewport and landscape `short:`),
  semantic color tokens only (light + dark), every string through `t(...)` with an
  English entry in `DICT` (`src/lib/i18n.tsx`), amounts via `money()`/`compact()` with
  `usePrivacy()`, respect `prefers-reduced-motion` for any animation or smooth scroll.
- **Schema changes:** new idempotent `vN` section + `database.types.ts` +
  `RESTORE_TABLES` in `backup.ts` + graceful fallback when the section isn't run.
- **New env vars:** optional where possible, add to `.env.example` and
  `docs/ENVIRONMENT.md`.
- When a change adds or alters an architectural rule, add a one-line rule to
  `AGENTS.md` (same terse style as the existing bullets).

## Git, commits and PRs

- Never commit directly to `main`; branch with `feat/`, `fix/`, `docs/`, `chore/`,
  `refactor/` or `test/`.
- [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): imperative lower-case summary`, with a body explaining _what_ and _why_.
  Several small logical commits beat one large one.
- The PR title becomes the squash commit and drives release-please
  (`feat` → minor, `fix` → patch, `!` → major). Don't edit `CHANGELOG.md` versioned
  entries or `package.json` `version` by hand.
- Fill in `.github/pull_request_template.md`: summary, linked issue, testing done,
  screenshots for UI (mobile + desktop, light + dark).
- **Lovable sync:** never force-push or rewrite already-pushed history (see the note at
  the top of `AGENTS.md`); add new commits instead.

## Community

Follow [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues go through
[`SECURITY.md`](SECURITY.md), never public issues or PRs. No secrets, personal data or
real API keys in code, fixtures, screenshots or logs.
