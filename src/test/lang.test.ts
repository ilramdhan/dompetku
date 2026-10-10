import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n";
import {
  isLangPath,
  langHref,
  langSearch,
  ogLocale,
  otherLang,
  parseLang,
  resolveLang,
  urlLangFor,
  validateLangSearch,
} from "@/lib/lang";

describe("parseLang / validateLangSearch", () => {
  it("accepts id and en in any case", () => {
    expect(parseLang("en")).toBe("en");
    expect(parseLang(" ID ")).toBe("id");
    expect(parseLang("fr")).toBeUndefined();
    expect(parseLang(1)).toBeUndefined();
    expect(parseLang(undefined)).toBeUndefined();
  });
  it("keeps only a valid lang search param", () => {
    expect(validateLangSearch({ lang: "en", utm: "x" })).toEqual({ lang: "en" });
    expect(validateLangSearch({ lang: "de" })).toEqual({});
    expect(validateLangSearch({})).toEqual({});
  });
});

describe("URL language", () => {
  it("is honoured on public pages only", () => {
    expect(isLangPath("/")).toBe(true);
    expect(isLangPath("/privacy/")).toBe(true);
    expect(isLangPath("/terms")).toBe(true);
    expect(isLangPath("/dashboard")).toBe(false);
    expect(urlLangFor("/", { lang: "en" })).toBe("en");
    expect(urlLangFor("/dashboard", { lang: "en" })).toBeUndefined();
    expect(urlLangFor("/", {})).toBeUndefined();
  });
  it("wins over the stored choice; stored beats the default", () => {
    expect(resolveLang("en", "id")).toBe("en");
    expect(resolveLang("id", "en")).toBe("id");
    expect(resolveLang(undefined, "en")).toBe("en");
    expect(resolveLang(undefined, "garbage")).toBe("id");
    expect(resolveLang(undefined, null)).toBe("id");
  });
  it("builds one crawlable URL per language", () => {
    expect(langHref("/", "id")).toBe("/");
    expect(langHref("/", "en")).toBe("/?lang=en");
    expect(langHref("/privacy/", "en", "#data")).toBe("/privacy?lang=en#data");
    expect(langHref("/?lang=en", "id", "fitur")).toBe("/#fitur");
    expect(langSearch("id")).toEqual({});
    expect(langSearch("en")).toEqual({ lang: "en" });
  });
  it("maps languages to Open Graph locales", () => {
    expect(ogLocale("id")).toBe("id_ID");
    expect(ogLocale("en")).toBe("en_US");
    expect(otherLang("id")).toBe("en");
  });
});

describe("translate", () => {
  it("returns English from DICT and the source string for id or unknown keys", () => {
    expect(translate("Kebijakan Privasi", "en")).toBe("Privacy Policy");
    expect(translate("Kebijakan Privasi", "id")).toBe("Kebijakan Privasi");
    expect(translate("zzz-unknown", "en")).toBe("zzz-unknown");
  });
  it("has English head copy for the landing title", () => {
    const title = "Dompetku — Pencatat Keuangan Open Source & Self-Hosted Expense Tracker";
    expect(translate(title, "en")).not.toBe(title);
  });
});
