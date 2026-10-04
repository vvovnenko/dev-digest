import { describe, it, expect } from "vitest";
import { isScanActive } from "./conventions";

describe("isScanActive", () => {
  it("is true only while a scan is queued or running", () => {
    expect(isScanActive({ status: "queued" })).toBe(true);
    expect(isScanActive({ status: "running" })).toBe(true);
    expect(isScanActive({ status: "done" })).toBe(false);
    expect(isScanActive({ status: "failed" })).toBe(false);
    expect(isScanActive(null)).toBe(false);
    expect(isScanActive(undefined)).toBe(false);
  });
});
