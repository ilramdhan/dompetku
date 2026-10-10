import { describe, expect, it } from "vitest";
import { pageHead } from "@/lib/head";
import { LANDING_FAQ } from "@/lib/landing";
import {
  absoluteUrl,
  faqJsonLd,
  normalizeSiteUrl,
  robotsContent,
  robotsTxt,
  seoConfigFrom,
  seoHead,
  sitemapXml,
  softwareAppJsonLd,
} from "@/lib/seo";

const metaOf = (meta: Record<string, unknown>[], key: string) =>
  meta.find((m) => m["name"] === key || m["property"] === key)?.["content"];

describe("site URL helpers", () => {
  it("normalises PUBLIC_SITE_URL to an origin without trailing slash", () => {
    expect(normalizeSiteUrl(" https://dompetku.example.com/ ")).toBe(
      "https://dompetku.example.com",
    );
    expect(normalizeSiteUrl("https://example.com/app/")).toBe("https://example.com/app");
    expect(normalizeSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("rejects empty, non-http and query/hash URLs", () => {
    expect(normalizeSiteUrl(undefined)).toBeNull();
    expect(normalizeSiteUrl("")).toBeNull();
    expect(normalizeSiteUrl("ftp://x.test")).toBeNull();
    expect(normalizeSiteUrl("not a url")).toBeNull();
    expect(normalizeSiteUrl("https://x.test/?a=1")).toBeNull();
    expect(normalizeSiteUrl("javascript:alert(1)")).toBeNull();
  });
  it("joins paths into absolute URLs", () => {
    expect(absoluteUrl("https://x.test", "/")).toBe("https://x.test/");
    expect(absoluteUrl("https://x.test/", "privacy")).toBe("https://x.test/privacy");
    expect(absoluteUrl("https://x.test/app", "/terms")).toBe("https://x.test/app/terms");
    expect(absoluteUrl("https://x.test", "https://cdn.test/a.png")).toBe("https://cdn.test/a.png");
  });
  it("maps the index flag to a robots directive", () => {
    expect(robotsContent(true)).toBe("index, follow");
    expect(robotsContent(false)).toBe("noindex, nofollow");
  });
  it("reads env: demo instances are never indexable", () => {
    expect(seoConfigFrom({})).toEqual({ siteUrl: null, indexable: true });
    expect(seoConfigFrom({ DEMO_MODE: "true", PUBLIC_SITE_URL: "https://d.test/" })).toEqual({
      siteUrl: "https://d.test",
      indexable: false,
    });
  });
});

describe("seoHead / pageHead", () => {
  it("omits robots by default so the root noindex applies (backward compatible)", () => {
    const h = pageHead("Masuk", "desc");
    expect(metaOf(h.meta, "robots")).toBeUndefined();
    expect(h.meta[0]).toEqual({ title: "Masuk — Dompetku" });
    expect(metaOf(h.meta, "twitter:card")).toBe("summary");
    expect(h.links).toEqual([]);
  });
  it("marks public pages indexable with canonical and og:url when a site URL is set", () => {
    const h = pageHead("Kebijakan Privasi", "d", {
      index: true,
      path: "/privacy",
      siteUrl: "https://x.test/",
    });
    expect(metaOf(h.meta, "robots")).toBe("index, follow");
    expect(metaOf(h.meta, "og:url")).toBe("https://x.test/privacy");
    expect(metaOf(h.meta, "og:site_name")).toBe("Dompetku");
    expect(metaOf(h.meta, "og:locale")).toBe("id_ID");
    expect(h.links).toEqual([{ rel: "canonical", href: "https://x.test/privacy" }]);
  });
  it("skips canonical without a site URL or when not indexable", () => {
    expect(pageHead("T", "d", { index: true, path: "/terms" }).links).toEqual([]);
    const demo = pageHead("T", "d", { index: false, path: "/terms", siteUrl: "https://x.test" });
    expect(metaOf(demo.meta, "robots")).toBe("noindex, nofollow");
    expect(demo.links).toEqual([]);
    expect(metaOf(demo.meta, "og:url")).toBeUndefined();
  });
  it("uses an absolute og:image only when the site URL is known", () => {
    const rel = seoHead({ title: "T", description: "d", largeImage: true });
    expect(metaOf(rel.meta, "og:image")).toBe("/icons/og-image.png");
    expect(metaOf(rel.meta, "twitter:card")).toBe("summary_large_image");
    const abs = seoHead({
      title: "T",
      description: "d",
      largeImage: true,
      siteUrl: "https://x.test",
    });
    expect(metaOf(abs.meta, "og:image")).toBe("https://x.test/icons/og-image.png");
    expect(metaOf(abs.meta, "twitter:image")).toBe("https://x.test/icons/og-image.png");
  });
});

describe("JSON-LD", () => {
  it("describes a free, MIT-licensed finance application", () => {
    const ld = softwareAppJsonLd({ description: "d", siteUrl: "https://x.test", version: "1.5.1" });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Dompetku",
      applicationCategory: "FinanceApplication",
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      codeRepository: "https://github.com/ilramdhan/dompetku",
      url: "https://x.test/",
      image: "https://x.test/icons/og-image.png",
      softwareVersion: "1.5.1",
      offers: { "@type": "Offer", price: "0" },
    });
  });
  it("falls back to the repository URL and drops an unknown version", () => {
    const ld = softwareAppJsonLd({ description: "d", version: "0.0.0" });
    expect(ld["url"]).toBe("https://github.com/ilramdhan/dompetku");
    expect(ld).not.toHaveProperty("softwareVersion");
    expect(ld).not.toHaveProperty("image");
  });
  it("builds a FAQPage from the landing FAQ (Indonesian source strings)", () => {
    const ld = faqJsonLd(LANDING_FAQ) as { "@type": string; mainEntity: unknown[] };
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toHaveLength(LANDING_FAQ.length);
    expect(ld.mainEntity[0]).toEqual({
      "@type": "Question",
      name: LANDING_FAQ[0]!.q,
      acceptedAnswer: { "@type": "Answer", text: LANDING_FAQ[0]!.a },
    });
  });
});

describe("sitemap.xml", () => {
  it("lists the public pages as absolute, escaped URLs", () => {
    const xml = sitemapXml("https://x.test", undefined, "2026-10-10T08:00:00Z");
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<url><loc>https://x.test/</loc><lastmod>2026-10-10</lastmod></url>");
    expect(xml).toContain("<loc>https://x.test/privacy</loc>");
    expect(xml).toContain("<loc>https://x.test/terms</loc>");
    expect(xml).not.toContain("dashboard");
    expect(sitemapXml("https://x.test", ["/a&b"])).toContain("<loc>https://x.test/a&amp;b</loc>");
    expect(sitemapXml("https://x.test", ["/"], "bogus")).not.toContain("lastmod");
  });
});

describe("robots.txt", () => {
  it("blocks everything on a demo instance", () => {
    expect(robotsTxt({ siteUrl: "https://d.test", indexable: false })).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });
  it("allows public pages, disallows API and app paths", () => {
    const txt = robotsTxt({ siteUrl: null, indexable: true });
    expect(txt).toMatch(/^User-agent: \*\nAllow: \/\n/);
    expect(txt).toContain("Disallow: /api/\n");
    expect(txt).toContain("Disallow: /dashboard\n");
    expect(txt).not.toContain("Disallow: /\n");
    expect(txt).not.toContain("Sitemap:");
  });
  it("adds the Sitemap line when the site URL is known", () => {
    expect(robotsTxt({ siteUrl: "https://x.test", indexable: true })).toContain(
      "\nSitemap: https://x.test/sitemap.xml\n",
    );
  });
});
