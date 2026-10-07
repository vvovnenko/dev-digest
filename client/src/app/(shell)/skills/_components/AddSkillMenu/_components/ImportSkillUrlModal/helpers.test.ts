import { describe, it, expect } from "vitest";
import { importedSkillPath, isImportableUrl, toImportRequest } from "./helpers";

describe("isImportableUrl", () => {
  it("accepts an absolute https URL, trimmed, in any letter case", () => {
    expect(isImportableUrl("https://raw.githubusercontent.com/org/repo/main/skill.md")).toBe(true);
    expect(isImportableUrl("  https://example.com/a.md  ")).toBe(true);
    expect(isImportableUrl("HTTPS://example.com/a.md")).toBe(true);
  });

  it("refuses blank text, other schemes and things that are not URLs", () => {
    expect(isImportableUrl("")).toBe(false);
    expect(isImportableUrl("   ")).toBe(false);
    expect(isImportableUrl("http://example.com/a.md")).toBe(false);
    expect(isImportableUrl("ftp://example.com/a.md")).toBe(false);
    expect(isImportableUrl("example.com/a.md")).toBe(false);
    expect(isImportableUrl("https://")).toBe(false);
    // `new URL` takes "https:host" as https://host/, but the API wants the "https://" prefix.
    expect(isImportableUrl("https:example.com/a.md")).toBe(false);
  });

  it("refuses a URL over 2048 characters", () => {
    const base = "https://example.com/";
    expect(isImportableUrl(base + "a".repeat(2048 - base.length))).toBe(true);
    expect(isImportableUrl(base + "a".repeat(2049 - base.length))).toBe(false);
  });
});

describe("toImportRequest", () => {
  it("trims the URL and sends the name only when one was typed", () => {
    expect(toImportRequest("  https://x.test/a.md ", "")).toEqual({ url: "https://x.test/a.md" });
    expect(toImportRequest("https://x.test/a.md", "   ")).toEqual({ url: "https://x.test/a.md" });
    expect(toImportRequest("https://x.test/a.md", "my-skill")).toEqual({ url: "https://x.test/a.md", name: "my-skill" });
  });
});

describe("importedSkillPath", () => {
  it("opens a clean skill on Preview and a blocked one on Config", () => {
    expect(importedSkillPath({ id: "s1", injection_detected: false })).toBe("/skills/s1?tab=preview");
    expect(importedSkillPath({ id: "s1", injection_detected: true })).toBe("/skills/s1?tab=config");
  });
});
