import { describe, it, expect } from "vitest";
import { acceptedCount, confidenceColor, confidencePercent, evidenceLabel, relativeNow } from "./helpers";

describe("confidence", () => {
  it("prints a whole, clamped percent", () => {
    expect(confidencePercent(0.914)).toBe(91);
    expect(confidencePercent(1.2)).toBe(100);
    expect(confidencePercent(-0.1)).toBe(0);
  });

  it("is green from 85%, amber from 65%, red below", () => {
    expect(confidenceColor(0.91)).toBe("var(--ok)");
    expect(confidenceColor(0.849)).toBe("var(--ok)"); // prints 85%
    expect(confidenceColor(0.84)).toBe("var(--warn)");
    expect(confidenceColor(0.65)).toBe("var(--warn)");
    expect(confidenceColor(0.6)).toBe("var(--crit)");
  });
});

describe("evidenceLabel", () => {
  it("shows a line range, or one line", () => {
    const at = (start: number, end: number) =>
      evidenceLabel({ evidence_path: "src/api/users.ts", evidence_start_line: start, evidence_end_line: end });
    expect(at(23, 31)).toBe("src/api/users.ts:23-31");
    expect(at(7, 7)).toBe("src/api/users.ts:7");
  });
});

describe("acceptedCount", () => {
  it("counts accepted candidates only", () => {
    expect(acceptedCount([{ status: "accepted" }, { status: "pending" }, { status: "accepted" }])).toBe(2);
    expect(acceptedCount([])).toBe(0);
  });
});

describe("relativeNow", () => {
  it("never puts now before the moment being printed", () => {
    const now = new Date("2026-10-04T10:00:00Z");
    const later = new Date("2026-10-04T10:01:00Z");
    expect(relativeNow(later, now)).toBe(later);
    expect(relativeNow(new Date("2026-10-04T09:00:00Z"), now)).toBe(now);
  });
});
