# Accessibility

Dompetku is a personal finance tracker. Everyone who manages their own money should be able to
use it, whether they use a keyboard, a screen reader, zoom or a small phone screen, and whether
they read Indonesian or English. This document lists what we aim for, what contributors are
expected to check, the gaps we already know about, and how to tell us when something gets in
your way.

## Priorities

We work toward [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. This is a **goal, not a
claim of conformance**: Dompetku has not been formally audited.

What we prioritise, in order:

1. **Keyboard use.** Every page, form, dialog and menu can be reached and used without a mouse,
   with a visible focus indicator. Dialogs and menus come from Radix UI (via shadcn/ui), which
   manages focus and the Escape key.
2. **Screen readers.** Icon-only buttons have a text label, pages use landmarks (`<main>`,
   `<nav>`, `<header>`), and the public pages start with a "Skip to content" link.
3. **Small screens and zoom.** The app is designed mobile-first (about 375 px wide and short
   landscape screens) and keeps working when the browser text is enlarged.
4. **Readable colours.** All colours come from shared light and dark theme tokens, so contrast is
   managed in one place for both themes.
5. **Reduced motion.** Smooth scrolling and animations are switched off when your device asks for
   reduced motion.
6. **Language.** The interface is available in Indonesian and English.

## Contributor expectations

For any change that affects what people see or use, please:

- Use the existing components in `src/components/ui` (shadcn/ui on Radix) rather than building
  your own dialogs, menus or form controls.
- Give every icon-only button an `aria-label` (or `sr-only` text), wrapped in `t(...)` so it is
  translated like any other text.
- Connect form inputs to a `<Label>`, and show validation errors as text, not only as a colour.
- Use semantic colour tokens only (see `src/styles.css`) and check both light and dark mode.
- Wrap any new animation or smooth scrolling in `prefers-reduced-motion: no-preference`.
- Try the change with the keyboard alone: Tab through it, open and close it with Enter, Space and
  Escape, and make sure focus is never lost or trapped.
- Check it at about 375 px wide and at 200% browser zoom.
- In the pull request, add mobile and desktop screenshots in light and dark mode (already part of
  the template), and say how you checked keyboard use.

There is no automated accessibility test in CI yet. Lint, typecheck, unit tests and the build
still have to pass as usual.

## Reporting accessibility issues

If something stops you from using Dompetku, please
[open a bug report](https://github.com/ilramdhan/dompetku/issues/new?template=bug_report.yml) and
start the title with **"Accessibility:"**. It helps to include:

- what you were trying to do (for example "add a transaction" or "read the monthly report");
- the page or screen;
- what happened, and what you expected to happen;
- your browser, operating system and device;
- any assistive technology you use (screen reader, voice control, magnification, switch access),
  if you are comfortable sharing it.

Screenshots or recordings are welcome but optional. You never need to tell us about a disability.
Please do not include real financial data, passwords, API keys or chat IDs.

If the bug report form itself is hard to use, the shorter
[question form](https://github.com/ilramdhan/dompetku/issues/new?template=question.yml) is fine
too. Just say it is about accessibility and we will take it from there.

### Severity

You don't need to choose a severity; the maintainer sets it during triage.

| Severity    | What it means                                                         | Example                                                 |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Blocker** | You cannot finish a core task (log in, add, edit or view money data). | A dialog cannot be closed or submitted with a keyboard. |
| **Major**   | You can finish the task, but only with a lot of effort or help.       | A button reads only as "button" in a screen reader.     |
| **Minor**   | It is annoying or confusing, but the task is still easy to complete.  | Focus jumps to the top of the page after saving.        |

### How we respond

Dompetku is maintained by one person in their spare time, so these are goals, not guarantees:

- We aim to reply to new reports within **7 days**.
- Blockers are fixed before new features. If a fix will take a while, we suggest a workaround in
  the issue.
- When a fix is released, we mention it in the issue and you are welcome to check that it works
  for you.

## Ownership and maintenance

The project maintainer ([@ilramdhan](https://github.com/ilramdhan), see
[`.github/CODEOWNERS`](.github/CODEOWNERS)) is responsible for accessibility: triaging reports,
reviewing pull requests against the expectations above, and keeping this document up to date.
We review this document at least once a year and whenever something major changes, such as a new
UI library or a new kind of screen. If ownership changes, the new maintainer is listed here and in
`CODEOWNERS`.

## Supported environments

Dompetku is a web app (installable as a PWA) plus an optional Telegram bot.

- **Browsers:** current versions of Chrome, Edge, Firefox and Safari on desktop, and Chrome on
  Android and Safari on iOS.
- **Input:** mouse, touch and keyboard.
- **Screen sizes:** from about 375 px wide, including short landscape phone screens.
- **Themes:** light and dark mode, following your system setting or chosen in the app.
- **Telegram bot:** uses Telegram's own apps, so its accessibility depends on the Telegram client
  you use.

We have **not** systematically tested Dompetku with screen readers (NVDA, JAWS, VoiceOver,
TalkBack), voice control or switch access. It is built with those users in mind, but we can't yet
promise they will work well. Reports from people who use them are especially welcome.

## Known limitations

- **Charts** on the dashboard and reports pages are visual. The totals they show also appear as
  text on the same page (stat cards and category lists), but the charts have no full text or table
  alternative yet.
- **Telegram bot replies** use emoji and inline buttons, so some screen readers read out the emoji
  names.
- **Receipt scanning** (OCR) needs a photo of a receipt. You can always type the transaction in by
  hand instead.
- **Privacy mode** masks amounts with placeholder characters. Screen readers read out the mask, not
  the hidden amount, which is intentional.
- **Page language:** the page always declares Indonesian (`lang="id"`), even when English is
  selected, so some screen readers may pronounce English text with Indonesian rules.

## Feedback and improvements

Suggestions for this document or for how we handle accessibility are welcome. Open a
[feature request](https://github.com/ilramdhan/dompetku/issues/new?template=feature_request.yml)
or a pull request that changes this file. If something is stopping you from using the app right
now, please use [the reporting process above](#reporting-accessibility-issues) instead.
