import { describe, it, expect } from "vitest";
import type { ConventionScan } from "@devdigest/shared";
import { scanNotice } from "./helpers";

const scan = (id: string, status: ConventionScan["status"], extra: Partial<ConventionScan> = {}): ConventionScan => ({
  id,
  status,
  sample_files: [],
  provider: "openrouter",
  model: "m",
  candidates_found: 0,
  candidates_kept: 0,
  created_at: "2026-10-04T10:00:00Z",
  ...extra,
});

describe("scanNotice", () => {
  const done = scan("s1", "done");

  it("says nothing before any scan, or when the newest scan is the done one", () => {
    expect(scanNotice(null, null)).toBeNull();
    expect(scanNotice(done, done)).toBeNull();
  });

  it("reports a queued scan, and a running one from when it started", () => {
    expect(scanNotice(done, scan("s2", "queued"))).toEqual({ kind: "queued" });
    expect(scanNotice(done, scan("s2", "running", { started_at: "2026-10-04T10:01:00Z" }))).toEqual({
      kind: "running",
      since: "2026-10-04T10:01:00Z",
    });
    expect(scanNotice(null, scan("s2", "running"))).toEqual({ kind: "running", since: "2026-10-04T10:00:00Z" });
  });

  it("reports a failure newer than the done scan, with its reason or none", () => {
    expect(scanNotice(done, scan("s2", "failed", { error: "Model timed out" }))).toEqual({
      kind: "failed",
      error: "Model timed out",
    });
    expect(scanNotice(null, scan("s2", "failed", { error: "  " }))).toEqual({ kind: "failed", error: null });
    expect(scanNotice(null, scan("s2", "failed"))).toEqual({ kind: "failed", error: null });
  });
});
