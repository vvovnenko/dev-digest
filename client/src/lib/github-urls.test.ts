import { describe, it, expect } from "vitest";
import { githubBlobUrl, githubPrUrl } from "./github-urls";

describe("github-urls", () => {
  it("links a PR", () => {
    expect(githubPrUrl("acme/app", 482)).toBe("https://github.com/acme/app/pull/482");
  });

  it("links a file at the head sha, with a line or a range, and encodes each path segment", () => {
    expect(githubBlobUrl("acme/app", "abc", "src/a.ts")).toBe("https://github.com/acme/app/blob/abc/src/a.ts");
    expect(githubBlobUrl("acme/app", "abc", "src/a.ts", 11)).toBe("https://github.com/acme/app/blob/abc/src/a.ts#L11");
    expect(githubBlobUrl("acme/app", "abc", "src/a.ts", 11, 11)).toBe(
      "https://github.com/acme/app/blob/abc/src/a.ts#L11",
    );
    expect(githubBlobUrl("acme/app", "abc", "src/a.ts", 61, 74)).toBe(
      "https://github.com/acme/app/blob/abc/src/a.ts#L61-L74",
    );
    expect(githubBlobUrl("acme/app", "abc", "docs/my file#1.md")).toBe(
      "https://github.com/acme/app/blob/abc/docs/my%20file%231.md",
    );
  });
});
