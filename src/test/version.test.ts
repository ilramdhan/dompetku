import { describe, expect, it } from "vitest";
import {
  appCommit,
  appVersion,
  compareSemver,
  formatVersion,
  isNewer,
  parseLatestRelease,
  releaseUrl,
  repoFromUrl,
  shortVersion,
} from "@/lib/version";

describe("version", () => {
  it("has safe fallbacks outside the Vite build", () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof appCommit()).toBe("string");
  });

  it("formats version with optional commit", () => {
    expect(formatVersion({ version: "1.0.0", commit: "a349e4c" })).toBe("v1.0.0 · a349e4c");
    expect(formatVersion({ version: "v1.0.0", commit: "a349e4c", short: true })).toBe("v1.0.0");
    expect(formatVersion({ version: "1.2.3", commit: "" })).toBe("v1.2.3");
    expect(shortVersion("1.10.4")).toBe("1.10");
  });

  it("compares semver", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("v1.0.1", "1.0.0")).toBe(1);
    expect(compareSemver("1.9.0", "1.10.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0+build.5", "1.0.0")).toBe(0);
    expect(compareSemver("garbage", "1.0.0")).toBe(-1);
  });

  it("detects newer releases only for valid semver", () => {
    expect(isNewer("1.1.0", "1.0.0")).toBe(true);
    expect(isNewer("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.9.0", "1.0.0")).toBe(false);
    expect(isNewer("latest", "1.0.0")).toBe(false);
    expect(isNewer(null, "1.0.0")).toBe(false);
  });

  it("parses owner/repo from GitHub URLs", () => {
    expect(repoFromUrl(null)).toBe("ilramdhan/dompetku");
    expect(repoFromUrl("https://github.com/alice/my-fork")).toBe("alice/my-fork");
    expect(repoFromUrl("https://github.com/alice/my-fork.git")).toBe("alice/my-fork");
    expect(repoFromUrl("https://github.com/alice/my-fork/tree/main")).toBe("alice/my-fork");
    expect(repoFromUrl("https://gitlab.com/alice/x")).toBe("ilramdhan/dompetku");
    expect(repoFromUrl("http://github.com/alice/x")).toBe("ilramdhan/dompetku");
    expect(repoFromUrl("https://github.com/alice")).toBe("ilramdhan/dompetku");
    expect(repoFromUrl("not a url")).toBe("ilramdhan/dompetku");
  });

  it("builds release URLs", () => {
    expect(releaseUrl("alice/x", "1.2.0")).toBe("https://github.com/alice/x/releases/tag/v1.2.0");
    expect(releaseUrl("alice/x", "v1.2.0")).toBe("https://github.com/alice/x/releases/tag/v1.2.0");
  });

  it("shapes the GitHub latest-release payload", () => {
    expect(
      parseLatestRelease(
        { tag_name: "v1.1.0", html_url: "https://github.com/a/b/releases/tag/v1.1.0" },
        "a/b",
        "1.0.0",
      ),
    ).toEqual({ latest: "1.1.0", url: "https://github.com/a/b/releases/tag/v1.1.0", newer: true });
    expect(
      parseLatestRelease({ tag_name: "v1.0.0", html_url: "javascript:x" }, "a/b", "1.0.0"),
    ).toEqual({
      latest: "1.0.0",
      url: "https://github.com/a/b/releases/tag/v1.0.0",
      newer: false,
    });
    expect(parseLatestRelease({ message: "Not Found" }, "a/b")).toBeNull();
    expect(parseLatestRelease(null, "a/b")).toBeNull();
  });
});
