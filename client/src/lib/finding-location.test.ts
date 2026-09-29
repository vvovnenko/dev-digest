import { describe, it, expect } from "vitest";
import { lineLabel } from "./finding-location";

describe("lineLabel", () => {
  it("prints one line or a range", () => {
    expect(lineLabel({ start_line: 11, end_line: 11 })).toBe("11");
    expect(lineLabel({ start_line: 61, end_line: 74 })).toBe("61-74");
  });
});
