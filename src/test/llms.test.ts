import { describe, expect, it } from "vitest";
import { llmsTxt, LLMS_FEATURES } from "@/lib/llms";

describe("llmsTxt", () => {
  it("follows the llms.txt shape: H1, summary quote, sections with links", () => {
    const txt = llmsTxt({ siteUrl: "https://x.test/", demoUrl: "https://demo.x.test/" });
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# Dompetku");
    expect(lines[2]).toMatch(/^> Free, open source \(MIT\) and self-hosted/);
    expect(txt).toContain("## Key features");
    for (const f of LLMS_FEATURES) expect(txt).toContain(`- ${f}`);
    expect(txt).toContain("- [Website](https://x.test/)");
    expect(txt).toContain("- [Website (English)](https://x.test/?lang=en)");
    expect(txt).toContain("- [Source code on GitHub](https://github.com/ilramdhan/dompetku)");
    expect(txt).toContain("- [Live demo](https://demo.x.test)");
    expect(txt).toContain(
      "- [Self-hosting guide](https://github.com/ilramdhan/dompetku/blob/main/docs/SELF-HOSTING.md)",
    );
    expect(txt.endsWith("\n")).toBe(true);
  });
  it("omits site and demo links when unknown and uses a custom repo and name", () => {
    const txt = llmsTxt({
      appName: "Kas\nKeluarga",
      repo: "https://github.com/me/fork",
      demoUrl: "http://insecure.test",
    });
    expect(txt.startsWith("# Kas Keluarga\n")).toBe(true);
    expect(txt).not.toContain("[Website]");
    expect(txt).not.toContain("Live demo");
    expect(txt).not.toContain("Privacy policy");
    expect(txt).toContain("(https://github.com/me/fork/blob/main/docs/ENVIRONMENT.md)");
    expect(txt).toContain("(https://github.com/me/fork#readme)");
  });
});
