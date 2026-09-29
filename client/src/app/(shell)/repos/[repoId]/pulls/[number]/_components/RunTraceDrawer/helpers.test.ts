import { describe, it, expect } from "vitest";
import type { RunTrace } from "@devdigest/shared";
import { eventsToLog, formatSeconds, formatTokens, traceLog } from "./helpers";

describe("RunTraceDrawer helpers", () => {
  it("maps live events and a persisted log to the same log lines", () => {
    expect(eventsToLog([{ t: "10:00:01", kind: "info", msg: "start" }])).toEqual([{ t: "10:00:01", k: "info", m: "start" }]);
    const trace = { log: [{ t: "10:00:02", kind: "error", msg: "boom" }] } as RunTrace;
    expect(traceLog(trace)).toEqual([{ t: "10:00:02", k: "error", m: "boom" }]);
    expect(traceLog(undefined)).toEqual([]);
  });

  it("formats duration and token counts", () => {
    expect(formatSeconds(12_345)).toBe("12.3s");
    expect(formatTokens(12_000, 1_500)).toBe("12k→1.5k");
  });
});
