import { describe, it, expect } from "vitest";
import { estimateTokens, isValidSkillName, renderSkillBlock, withoutImages } from "./helpers";

describe("renderSkillBlock", () => {
  it("matches the engine's golden format", () => {
    // Same input and output as reviewer-core/test/prompt.test.ts — keep them in step.
    expect(
      renderSkillBlock({
        name: "branch-coverage",
        description: "Apply when the diff adds\n  a branch.",
        body: "\n## Rule\nFlag every new branch without a test.\n",
      }),
    ).toBe(
      "### branch-coverage\nWhen to apply: Apply when the diff adds a branch.\n\n## Rule\nFlag every new branch without a test.",
    );
  });

  it("drops the When-to-apply line for a blank description", () => {
    expect(renderSkillBlock({ name: "edge-cases", description: "  ", body: "Check empty input." })).toBe(
      "### edge-cases\n\nCheck empty input.",
    );
  });
});

describe("estimateTokens", () => {
  it("is ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("isValidSkillName", () => {
  it("accepts kebab-case up to 64 characters", () => {
    expect(isValidSkillName("branch-coverage")).toBe(true);
    expect(isValidSkillName("v2")).toBe(true);
    expect(isValidSkillName("a".repeat(64))).toBe(true);
  });

  it("rejects everything else", () => {
    for (const bad of ["", "Branch", "a--b", "-a", "a-", "a b", "a_b", "a".repeat(65)]) {
      expect(isValidSkillName(bad)).toBe(false);
    }
  });
});

describe("withoutImages", () => {
  it("turns images into link labels and leaves links alone", () => {
    expect(withoutImages("see ![pixel](https://x.test/p.gif) and [docs](https://d.test)")).toBe(
      "see [image: pixel](https://x.test/p.gif) and [docs](https://d.test)",
    );
  });
});
