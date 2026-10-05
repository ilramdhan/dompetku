# Releasing Dompetku

Dompetku uses [release-please](https://github.com/googleapis/release-please) to turn [Conventional Commits](https://www.conventionalcommits.org) on `main` into versioned releases. There is nothing to build or publish: a release is a **git tag + GitHub Release + CHANGELOG entry** that tells self-hosters what changed.

## How it works

```text
 contributor PR                 main                       release-please (GitHub Action)
 ─────────────                  ────                       ──────────────────────────────
 feat(bot): add /undo  ──squash──▶ commit ──push──▶  opens / updates the Release PR
 fix(goals): …         ──squash──▶ commit ──push──▶  "chore(release): v1.1.0"
                                                      ├─ bumps package.json "version"
                                                      ├─ updates .release-please-manifest.json
                                                      └─ prepends a CHANGELOG.md entry

 maintainer merges the Release PR ──push──▶  release-please:
                                              ├─ creates tag v1.1.0
                                              └─ publishes GitHub Release v1.1.0 (notes = changelog entry)

 Vercel / Lovable deploy from main as usual — releases don't change deployment.
```

- Workflow: [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) (runs on every push to `main`, and manually via **Actions → Release Please → Run workflow**).
- Config: [`release-please-config.json`](../release-please-config.json) (release type `node`, tags `vX.Y.Z`, changelog sections).
- Current version: [`.release-please-manifest.json`](../.release-please-manifest.json) — release-please owns this file; don't edit it by hand except to fix a mistake.

### Version bumps (SemVer)

| Commit on `main`                                            | Bump                    |
| ----------------------------------------------------------- | ----------------------- |
| `fix: …`, `perf: …`                                         | patch (`1.0.0 → 1.0.1`) |
| `feat: …`                                                   | minor (`1.0.0 → 1.1.0`) |
| `feat!: …` or a `BREAKING CHANGE:` footer                   | major (`1.0.0 → 2.0.0`) |
| `docs`, `refactor`, `chore`, `ci`, `test`, `style`, `build` | no release on their own |

A schema change that self-hosters must run (`supabase/schema.sql` `vN` section) is not breaking as long as the app degrades gracefully without it — use `feat` and mention the section in the PR title or body.

### Changelog sections

| Type                                    | Section in CHANGELOG / release notes |
| --------------------------------------- | ------------------------------------ |
| `feat`                                  | Features                             |
| `fix`                                   | Bug Fixes                            |
| `perf`                                  | Performance                          |
| `revert`                                | Reverts                              |
| `docs`                                  | Documentation                        |
| `refactor`                              | Maintenance                          |
| `chore`, `ci`, `test`, `style`, `build` | hidden                               |

Dependabot commits are `chore(deps): …` (npm) and `ci: …` (GitHub Actions), so they are hidden and never trigger a release by themselves; they ship with the next `feat`/`fix` release.

## What the maintainer does

1. **Merge PRs with Conventional Commit titles.** Prefer **Squash and merge**: GitHub uses the PR title as the commit message, so the PR title is what release-please reads.
2. **Let the Release PR accumulate.** release-please keeps a single open PR titled `chore(release): vX.Y.Z` and updates it after every push to `main`.
3. **When you want to ship, merge the Release PR** (squash is fine). The tag `vX.Y.Z` and the GitHub Release are created a minute later.

That's it — no local commands, no `npm publish`.

### Squash-merge title rules

- Format: `type(scope): short imperative description`, lower case, no trailing period — e.g. `feat(budgets): carry over unused budget`.
- The title decides the bump. Retitle the PR before merging if it doesn't match the change (`Update stuff` produces no changelog entry at all).
- Breaking change: add `!` (`feat(api)!: rename n8n endpoints`) or put `BREAKING CHANGE: …` in the squash commit body.
- One PR with several kinds of change? Either split it, or add extra Conventional Commit lines to the squash body — release-please parses each line of the form `fix: …` / `feat: …` in the body as a separate entry.
- If you use **Create a merge commit** instead, release-please reads the individual commits in the PR, so each of them must follow the convention.

## First release (v1.0.0)

The repository had no numbered releases before; `package.json` was set to `0.0.0` and the manifest to `"0.0.0"`. To make the first release **1.0.0** (the app is feature-complete and public):

- `release-please-config.json` temporarily set `"release-as": "1.0.0"` for the root package, so the first Release PR was `chore(release): v1.0.0` regardless of commit types.
- `"bootstrap-sha"` points to the last commit on `main` before release-please was introduced. Without it, release-please would scan the entire history (there is no previous tag) and dump every old commit into the changelog; the manually written history already lives in `CHANGELOG.md`.

v1.0.0 was released on 2026-10-04 and `release-as` has since been removed, so versions now follow Conventional Commits (`fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE` → major). Only re-add `release-as` when you deliberately want to force a specific version, and remove it again after that release. `"bootstrap-sha"` is kept but ignored now that a release tag exists.

### CHANGELOG.md layout

release-please inserts each new version directly above the first existing version heading — i.e. above the manual `## [Unreleased]` / dated sections. The Keep-a-Changelog header and the schema-section note stay on top. Don't hand-edit generated entries; to fix wording, edit the Release PR before merging it.

## Manual release (fallback)

Use this if the action is broken or you need to release a specific version.

- **Force a version through release-please:** push (or squash-merge) a commit with a `Release-As: 1.2.3` footer, e.g. an empty commit `git commit --allow-empty -m "chore: release 1.2.3" -m "Release-As: 1.2.3"`. The Release PR switches to that version.
- **Re-run:** Actions → Release Please → Run workflow.
- **Fully manual:** bump `version` in `package.json` and `.release-please-manifest.json`, add a `## [1.2.3](…) (YYYY-MM-DD)` entry at the top of `CHANGELOG.md`, merge to `main`, then on GitHub go to **Releases → Draft a new release**, create tag `v1.2.3` on `main` and click **Generate release notes** (categories come from [`.github/release.yml`](../.github/release.yml), grouped by PR label). Keep the manifest in sync, or release-please will get confused on its next run.

## Why no npm package or Docker image?

Dompetku is an application that every user deploys for themselves with their own Supabase project and secrets — not a library. Nothing consumes it from a registry:

- The maintainer's Vercel (and Lovable) deploy straight from `main`; releases are only a label on a commit.
- Self-hosters who forked the repo update with **Sync fork** on GitHub (their Vercel redeploys automatically), or pin a known-good tag (`git checkout v1.2.3` / deploy that tag).
- A Docker image would need per-user env at runtime and isn't part of the supported setup ([`docs/SELF-HOSTING.md`](SELF-HOSTING.md)).

`package.json` stays `"private": true`, so an accidental `npm publish` is refused.

## How self-hosters follow releases

- On the repository page click **Watch → Custom → Releases → Apply** to get a notification for each new version.
- Or subscribe to the Atom feed `https://github.com/ilramdhan/dompetku/releases.atom`.
- Before updating, read the release notes for any new `supabase/schema.sql` section to run.
- The app itself shows the running version (sidebar, Settings → **Tentang aplikasi**, landing footer) and, once a day at most, checks `https://api.github.com/repos/<owner>/<repo>/releases/latest` (repo from Settings `github_url`, else upstream). When a newer release exists it shows **Update tersedia: vX.Y.Z**; on a fork click **Sync fork → Update branch** and Vercel redeploys.
- The version comes from `package.json` `"version"` (bumped by release-please), so the badge updates automatically with each release build; the commit SHA comes from `VERCEL_GIT_COMMIT_SHA` (or `git` locally, empty when unavailable).

## One-time repository setting

release-please opens PRs with the built-in `GITHUB_TOKEN`, which GitHub forbids by default. Enable:

**Settings → Actions → General → Workflow permissions →** check **"Allow GitHub Actions to create and approve pull requests"** (and keep "Read and write permissions" or rely on the workflow's explicit `contents: write` / `pull-requests: write`).

Without it the workflow fails with `GitHub Actions is not permitted to create or approve pull requests`.

> [!NOTE]
> PRs and tags created with `GITHUB_TOKEN` don't trigger other workflows, so CI won't run on the Release PR automatically. That's fine — it only touches `package.json`, the manifest and `CHANGELOG.md`. If you want checks on it anyway, close and reopen the PR, or switch the workflow to a fine-grained personal access token stored as a secret.
