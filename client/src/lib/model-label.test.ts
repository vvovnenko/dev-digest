import { describe, it, expect } from "vitest";
import { modelLabel, toModelOptions } from "./model-label";

describe("model-label", () => {
  it("adds price per 1M and context window when known", () => {
    expect(
      modelLabel({ id: "deepseek/v4", pricing: { promptPerM: 0.14, completionPerM: 0.28 }, contextLength: 1_048_576 }),
    ).toBe("deepseek/v4 — $0.140/$0.280 per 1M · 1M ctx");
    expect(modelLabel({ id: "gpt-4.1", pricing: { promptPerM: 2, completionPerM: 8 } })).toBe(
      "gpt-4.1 — $2.00/$8.00 per 1M",
    );
    expect(modelLabel({ id: "free", pricing: { promptPerM: 0, completionPerM: 0 }, contextLength: 128_000 })).toBe(
      "free — $0/$0 per 1M · 128k ctx",
    );
    expect(modelLabel({ id: "bare" })).toBe("bare");
  });

  it("gives priced models a rich option and leaves bare ids as strings", () => {
    expect(toModelOptions([{ id: "bare" }, { id: "big", contextLength: 200_000 }])).toEqual([
      "bare",
      { value: "big", label: "big — 200k ctx" },
    ]);
    expect(toModelOptions(undefined)).toEqual([]);
  });
});
