import { describe, it, expect } from "vitest";
import { checkFile, dataUrlToBase64 } from "./helpers";

describe("checkFile", () => {
  it("accepts .md, .markdown and .zip up to 512 KiB", () => {
    expect(checkFile({ name: "skill.md", size: 10 })).toBeNull();
    expect(checkFile({ name: "SKILL.MARKDOWN", size: 10 })).toBeNull();
    expect(checkFile({ name: "flaky.zip", size: 512 * 1024 })).toBeNull();
  });

  it("rejects other extensions and oversized files", () => {
    expect(checkFile({ name: "run.sh", size: 10 })).toBe("wrong_type");
    expect(checkFile({ name: "big.zip", size: 512 * 1024 + 1 })).toBe("too_large");
  });
});

describe("dataUrlToBase64", () => {
  it("keeps only the payload", () => {
    expect(dataUrlToBase64("data:application/zip;base64,UEsDBA==")).toBe("UEsDBA==");
    expect(dataUrlToBase64("garbage")).toBe("");
  });
});
