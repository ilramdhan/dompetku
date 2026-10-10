/**
 * Pure builder for `/llms.txt` (https://llmstxt.org): a short Markdown overview of the project
 * for AI assistants and generative search engines. Served by `src/routes/llms[.]txt.ts`; 404 on
 * a demo instance, like the sitemap.
 */
import { absoluteUrl, normalizeSiteUrl } from "./seo";
import { DEFAULT_REPO_URL, docsUrl, repoUrl } from "./landing";

export type LlmsTxtInput = {
  /** App name from Settings (falls back to Dompetku). */
  appName?: string | null | undefined;
  /** Normalised PUBLIC_SITE_URL, or null. */
  siteUrl?: string | null | undefined;
  /** Repository URL from Settings (`github_url`), else the upstream repo. */
  repo?: string | null | undefined;
  /** Public demo URL (env PUBLIC_DEMO_URL via brandingOf), or null. */
  demoUrl?: string | null | undefined;
};

export const LLMS_FEATURES: ReadonlyArray<string> = [
  "Income, expense and transfer tracking across multiple wallets/accounts, with categories, split transactions and up to 5 receipt photos per transaction",
  "Telegram bot for logging transactions in chat (quick text parsing, AI only when ambiguous) and receipt OCR through any OpenAI-compatible endpoint",
  "Budgets with rollover and 80%/100% alerts, pockets (envelopes) inside a wallet, savings goals and recurring transactions",
  "Debts and installments, subscriptions, receivables and gold holdings (live world/Antam prices) counted in net worth",
  "Reports, yearly recap, account reconciliation, CSV import/export and full JSON backup/restore",
  "Family members with per-wallet permissions, optional TOTP 2FA, privacy mode and an Indonesian/English UI",
  "Installable PWA; free to run on the free tiers of Vercel and Supabase",
];

const DOCS: ReadonlyArray<{ file: string; title: string; desc: string }> = [
  { file: "README.md", title: "README", desc: "overview, screenshots and quick start" },
  {
    file: "docs/SELF-HOSTING.md",
    title: "Self-hosting guide",
    desc: "step-by-step deploy on Vercel + Supabase, no coding required",
  },
  {
    file: "docs/ENVIRONMENT.md",
    title: "Environment variables",
    desc: "every setting, which are optional and what each one does",
  },
  { file: "docs/N8N.md", title: "Telegram bot & n8n", desc: "bot setup and automation endpoints" },
  { file: "docs/ARCHITECTURE.md", title: "Architecture", desc: "how the app is built" },
  { file: "docs/FAQ.md", title: "FAQ", desc: "common questions" },
];

const clean = (s: string | null | undefined) => (s ?? "").replace(/[\r\n]+/g, " ").trim();

const httpsOrNull = (u: string | null | undefined): string | null => {
  try {
    return u && new URL(u).protocol === "https:" ? u.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};

export function llmsTxt(input: LlmsTxtInput = {}): string {
  const name = clean(input.appName) || "Dompetku";
  const site = normalizeSiteUrl(input.siteUrl);
  const repo = repoUrl(input.repo);
  const demo = httpsOrNull(input.demoUrl);
  const lines: string[] = [
    `# ${name}`,
    "",
    "> Free, open source (MIT) and self-hosted personal finance tracker: a web app plus a Telegram bot with receipt OCR. Each user deploys their own copy on their own Supabase database, so financial data never leaves their infrastructure.",
    "",
    `${name} (Indonesian for "my wallet") is built for Indonesian households (rupiah, installments, gold) and works in Indonesian and English. It is a single-owner app with optional family members; there is no hosted SaaS and no central server that sees user data. Stack: TanStack Start (React 19), Tailwind CSS, Supabase (Postgres + Storage), deployable on Vercel.`,
    "",
    "## Key features",
    "",
    ...LLMS_FEATURES.map((f) => `- ${f}`),
    "",
    "## Links",
    "",
  ];
  if (site) {
    lines.push(`- [Website](${absoluteUrl(site, "/")}): landing page (Indonesian)`);
    lines.push(`- [Website (English)](${absoluteUrl(site, "/?lang=en")}): landing page in English`);
  }
  lines.push(`- [Source code on GitHub](${repo}): MIT-licensed repository, issues and releases`);
  if (demo) lines.push(`- [Live demo](${demo}): public demo with sample data, resets daily`);
  lines.push("", "## Docs", "");
  for (const d of DOCS) {
    const url = d.file === "README.md" ? `${repo}#readme` : docsUrl(repo, d.file);
    lines.push(`- [${d.title}](${url}): ${d.desc}`);
  }
  lines.push("", "## Optional", "");
  if (site) {
    lines.push(`- [Privacy policy](${absoluteUrl(site, "/privacy?lang=en")})`);
    lines.push(`- [Terms of service](${absoluteUrl(site, "/terms?lang=en")})`);
  }
  lines.push(
    `- [License (MIT)](${docsUrl(repo, "LICENSE")})`,
    `- [Upstream project](${DEFAULT_REPO_URL})`,
  );
  return `${lines.join("\n")}\n`;
}
