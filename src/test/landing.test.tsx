import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRANDING } from "@/lib/app-settings";
import { docsUrl, landingRedirect, repoUrl, screenshotSrc } from "@/lib/landing";
import { routeTree } from "@/routeTree.gen";

const session = vi.hoisted(() => ({ authenticated: false }));
const branding = vi.hoisted(() => ({
  landing_enabled: true,
  demo_url: null as string | null,
}));
const demoMode = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/demo.functions", () => ({
  getDemoInfo: vi.fn(async () =>
    demoMode.on ? { demo: true, username: "demo", password: "demo-pass" } : { demo: false },
  ),
}));

vi.mock("@/lib/auth.functions", () => ({
  getSession: vi.fn(async () => ({
    authenticated: session.authenticated,
    user: session.authenticated ? "me" : null,
  })),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/app-settings.functions", () => ({
  getPublicBranding: vi.fn(async () => ({ ...DEFAULT_BRANDING, ...branding })),
  getAppSettingsFull: vi.fn(),
  saveAppSettingsFn: vi.fn(),
}));

async function load(path: string) {
  const queryClient = new QueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router;
}

afterEach(async () => {
  cleanup();
  session.authenticated = false;
  branding.landing_enabled = true;
  branding.demo_url = null;
  demoMode.on = false;
  const { clearSessionCache } = await import("@/lib/session-cache");
  clearSessionCache();
});

describe("landingRedirect", () => {
  it("renders the landing page when enabled", () => {
    expect(landingRedirect({ enabled: true, authenticated: false })).toBeNull();
    expect(landingRedirect({ enabled: true, authenticated: true })).toBeNull();
  });
  it("skips to login or dashboard when disabled", () => {
    expect(landingRedirect({ enabled: false, authenticated: false })).toBe("/login");
    expect(landingRedirect({ enabled: false, authenticated: true })).toBe("/dashboard");
  });
});

describe("landing link helpers", () => {
  it("falls back to the upstream repo for missing or non-https URLs", () => {
    expect(repoUrl(null)).toBe("https://github.com/ilramdhan/dompetku");
    expect(repoUrl("http://github.com/a/b")).toBe("https://github.com/ilramdhan/dompetku");
    expect(repoUrl("https://github.com/a/b/")).toBe("https://github.com/a/b");
  });
  it("builds docs links on GitHub repos only", () => {
    expect(docsUrl("https://github.com/a/b", "docs/FAQ.md")).toBe(
      "https://github.com/a/b/blob/main/docs/FAQ.md",
    );
    expect(docsUrl("https://gitlab.com/a/b", "LICENSE")).toBe(
      "https://github.com/ilramdhan/dompetku/blob/main/LICENSE",
    );
  });
  it("maps screenshot names to light and dark files", () => {
    expect(screenshotSrc("dashboard")).toBe("/screenshots/dashboard.png");
    expect(screenshotSrc("dashboard", true)).toBe("/screenshots/dashboard-dark.png");
  });
});

describe("landing route", () => {
  it("renders the landing with a sign-in button for visitors", async () => {
    const router = await load("/");
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    const signIn = screen.getAllByRole("link", { name: "Masuk" });
    expect(signIn[0]).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Buka Dashboard" })).toBeNull();
  });

  it("offers the dashboard when already signed in", async () => {
    session.authenticated = true;
    const router = await load("/");
    render(<RouterProvider router={router} />);
    const open = await screen.findAllByRole("link", { name: "Buka Dashboard" });
    expect(open[0]).toHaveAttribute("href", "/dashboard");
  });

  it("redirects to /login when the landing page is disabled", async () => {
    branding.landing_enabled = false;
    const router = await load("/");
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("demo links", () => {
  it("hides 'Coba demo' when PUBLIC_DEMO_URL is not set", async () => {
    const router = await load("/");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: "Coba demo" })).toBeNull();
  });

  it("links to the demo from navbar, hero and final CTA when configured", async () => {
    branding.demo_url = "https://demo.example.com";
    const router = await load("/");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1 });
    const links = await screen.findAllByRole("link", { name: "Coba demo" });
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const l of links) expect(l).toHaveAttribute("href", "https://demo.example.com");
  });

  it("makes 'Masuk ke demo' the hero CTA on a demo instance", async () => {
    demoMode.on = true;
    branding.demo_url = "https://demo.example.com";
    const router = await load("/");
    render(<RouterProvider router={router} />);
    const cta = await screen.findAllByRole("link", { name: "Masuk ke demo" });
    expect(cta[0]).toHaveAttribute("href", "/login");
    // The demo instance never links to itself.
    expect(screen.queryByRole("link", { name: "Coba demo" })).toBeNull();
  });

  it("offers one-click sign-in with prefilled credentials on the demo login page", async () => {
    demoMode.on = true;
    const router = await load("/login");
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("button", { name: "Masuk ke demo" })).toBeInTheDocument();
    expect(screen.getByText(/Ini instance demo/)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("demo");
    expect(screen.getByLabelText("Password")).toHaveValue("demo-pass");
  });

  it("shows no demo hints on a normal login page", async () => {
    const router = await load("/login");
    render(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "Masuk" });
    expect(screen.queryByRole("button", { name: "Masuk ke demo" })).toBeNull();
    expect(screen.getByLabelText("Username")).toHaveValue("");
  });
});

describe("landing polish", () => {
  it("renders the tech marquee with one accessible list and an aria-hidden duplicate", async () => {
    const router = await load("/");
    render(<RouterProvider router={router} />);
    const marquee = await screen.findByTestId("tech-marquee");
    const lists = Array.from(marquee.querySelectorAll("ul"));
    expect(lists).toHaveLength(2);
    expect(lists[0]).not.toHaveAttribute("aria-hidden");
    expect(lists[1]).toHaveAttribute("aria-hidden", "true");
    // Only the first set is exposed to assistive tech (static fallback hides the copy via CSS).
    const visible = within(marquee).getAllByRole("listitem");
    const [first] = lists;
    expect(visible).toHaveLength(first!.children.length);
    expect(within(first!).getByText("Supabase")).toBeInTheDocument();
  });

  it("links to the legal pages from the footer and offers back-to-top", async () => {
    const router = await load("/");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1 });
    const privacy = screen.getAllByRole("link", { name: "Privasi" });
    expect(privacy[0]).toHaveAttribute("href", "/privacy");
    expect(screen.getAllByRole("link", { name: "Ketentuan" })[0]).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("button", { name: "Kembali ke atas" })).toBeInTheDocument();
  });
});

describe("marquee reduced-motion fallback", () => {
  it("stops the animation, wraps the logos and hides the duplicate set", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/styles.css`, "utf8");
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    expect(block).toMatch(/\.landing-marquee-track\s*{[^}]*animation:\s*none/);
    expect(block).toMatch(/\.landing-marquee-group\s*{[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/\.landing-marquee-group\[aria-hidden="true"\]\s*{[^}]*display:\s*none/);
  });

  it("scrolls smoothly app-wide only without reduced motion, with sticky-safe overflow", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/styles.css`, "utf8");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*{\s*html\s*{[^}]*scroll-behavior:\s*smooth/,
    );
    // `clip` must come after the `hidden` fallback so html/body do not break position: sticky.
    expect(css).toMatch(/overflow-x:\s*hidden;\s*overflow-x:\s*clip;/);
  });
});

describe("legal routes", () => {
  it("renders the privacy policy with its sections and update date", async () => {
    const router = await load("/privacy");
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Kebijakan Privasi" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Cookie & penyimpanan browser/ }),
    ).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("dateTime", "2026-10-04");
    // Section links in the shared header point back to the landing page.
    expect(screen.getAllByRole("link", { name: "Fitur" })[0]).toHaveAttribute("href", "/#fitur");
  });

  it("renders the terms page for visitors even when the landing is disabled", async () => {
    branding.landing_enabled = false;
    const router = await load("/terms");
    render(<RouterProvider router={router} />);
    expect(router.state.location.pathname).toBe("/terms");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Syarat & Ketentuan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Bukan nasihat keuangan/ })).toBeInTheDocument();
  });
});
