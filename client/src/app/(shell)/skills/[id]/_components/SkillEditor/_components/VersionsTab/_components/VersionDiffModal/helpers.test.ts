import { describe, it, expect } from "vitest";
import { fieldChanges, lineDiff } from "./helpers";

const kinds = (d: ReturnType<typeof lineDiff>) => d?.map((l) => `${l.kind[0]}:${l.text}`);

describe("lineDiff", () => {
  it("marks removed and added lines and keeps the rest", () => {
    expect(kinds(lineDiff("a\nb\nc", "a\nB\nc\nd"))).toEqual(["s:a", "d:b", "a:B", "s:c", "a:d"]);
  });

  it("reports no change as all-same lines", () => {
    expect(kinds(lineDiff("x\ny", "x\ny"))).toEqual(["s:x", "s:y"]);
  });

  it("handles an empty side", () => {
    expect(kinds(lineDiff("", "a"))).toEqual(["d:", "a:a"]);
  });

  it("returns null when the changed middle is too large", () => {
    const big = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    const other = Array.from({ length: 50 }, (_, i) => `m${i}`).join("\n");
    expect(lineDiff(big, other, 100)).toBeNull();
    expect(lineDiff(big, other)).not.toBeNull();
  });
});

describe("fieldChanges", () => {
  it("lists only the fields that differ", () => {
    expect(
      fieldChanges(
        { name: "a", description: "d", type: "rubric" },
        { name: "a", description: "D", type: "custom" },
      ),
    ).toEqual([
      { field: "description", from: "d", to: "D" },
      { field: "type", from: "rubric", to: "custom" },
    ]);
  });
});
