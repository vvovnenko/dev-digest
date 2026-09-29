import { describe, it, expect } from "vitest";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import { allFindings, liveRunIds, parseTab } from "./helpers";

describe("PR detail helpers", () => {
  it("takes the live runs from the run history", () => {
    const runs = [
      { run_id: "a", status: "running" },
      { run_id: "b", status: "done" },
      { run_id: "c", status: "running" },
    ] as RunSummary[];
    expect(liveRunIds(runs)).toEqual(["a", "c"]);
    expect(liveRunIds(undefined)).toEqual([]);
  });

  it("flattens findings and reads ?tab=", () => {
    const reviews = [{ findings: [{ id: "1" }] }, { findings: [{ id: "2" }, { id: "3" }] }] as ReviewRecord[];
    expect(allFindings(reviews).map((f) => f.id)).toEqual(["1", "2", "3"]);
    expect(parseTab("findings")).toBe("findings");
    expect(parseTab("nope")).toBe("overview");
    expect(parseTab(null)).toBe("overview");
  });
});
