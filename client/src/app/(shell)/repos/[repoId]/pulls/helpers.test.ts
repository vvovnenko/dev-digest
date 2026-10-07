import { describe, it, expect } from "vitest";
import type { PrMeta } from "./constants";
import { countPulls, filterPulls, parseSort, relativeTime, sizeOf, sortPulls } from "./helpers";

const pr = (number: number, status: string, title: string, updated_at: string | null): PrMeta =>
  ({ number, status, title, updated_at }) as PrMeta;

const PULLS = [
  pr(1, "needs_review", "Add login", "2026-09-01T00:00:00Z"),
  pr(2, "reviewed", "Fix logout", "2026-09-03T00:00:00Z"),
  pr(13, "merged", "Refactor login form", null),
];

describe("PR list helpers", () => {
  it("filters by status chip and by title or number", () => {
    expect(filterPulls(PULLS, "all", "").map((p) => p.number)).toEqual([1, 2, 13]);
    expect(filterPulls(PULLS, "needs_review", "").map((p) => p.number)).toEqual([1]);
    expect(filterPulls(PULLS, "all", " LOGIN ").map((p) => p.number)).toEqual([1, 13]);
    expect(filterPulls(PULLS, "all", "13").map((p) => p.number)).toEqual([13]);
  });

  it("sorts by last update without touching the input; undated PRs count as oldest", () => {
    expect(sortPulls(PULLS, "newest").map((p) => p.number)).toEqual([2, 1, 13]);
    expect(sortPulls(PULLS, "oldest").map((p) => p.number)).toEqual([13, 1, 2]);
    expect(PULLS.map((p) => p.number)).toEqual([1, 2, 13]);
  });

  it("reads ?sort= and counts open / needs-review PRs", () => {
    expect(parseSort("oldest")).toBe("oldest");
    expect(parseSort("sideways")).toBe("newest");
    expect(parseSort(null)).toBe("newest");
    expect(countPulls(PULLS)).toEqual({ open: 2, needsReview: 1 });
  });
});

describe("PR list row helpers", () => {
  it("buckets a PR by changed lines: S under 100, M under 400, else L", () => {
    const size = (additions: number, deletions: number) => sizeOf({ additions, deletions } as PrMeta);
    expect(size(60, 39)).toEqual({ size: "S", lines: 99 });
    expect(size(100, 0)).toEqual({ size: "M", lines: 100 });
    expect(size(399, 0).size).toBe("M");
    expect(size(300, 100)).toEqual({ size: "L", lines: 400 });
  });

  it("prints a compact age and — for a missing or bad date", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(relativeTime(ago(10_000))).toBe("now");
    expect(relativeTime(ago(5 * 60_000))).toBe("5m");
    expect(relativeTime(ago(3 * 3_600_000))).toBe("3h");
    expect(relativeTime(ago(2 * 86_400_000))).toBe("2d");
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("not a date")).toBe("—");
  });
});

