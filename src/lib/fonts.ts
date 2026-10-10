/**
 * Font preload links (self-hosted woff2 in public/fonts, @font-face in styles.css).
 *
 * The root preloads only the latin subsets every page paints at first render: Figtree (body) and
 * Bricolage Grotesque (headings + the "Dompetku." wordmark, the LCP text). JetBrains Mono (`.num`)
 * is preloaded only by routes that render amounts on load (landing, app shell); elsewhere (login,
 * privacy, terms) it loads on demand via @font-face so it does not compete with the CSS and entry JS.
 * latin-ext files are never preloaded (unicode-range fetches them only when needed).
 */
export const FONT_BODY = "figtree-latin-wght-normal";
export const FONT_DISPLAY = "bricolage-grotesque-latin-opsz-normal";
export const FONT_MONO = "jetbrains-mono-latin-wght-normal";

export function fontPreloads(...names: string[]) {
  return names.map((f) => ({
    rel: "preload",
    href: `/fonts/${f}.woff2`,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous" as const,
  }));
}
