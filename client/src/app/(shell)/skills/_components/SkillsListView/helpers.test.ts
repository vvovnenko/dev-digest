import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { filterSkills } from "./helpers";

const skill = (name: string, description: string, type: Skill["type"] = "custom"): Skill => ({
  id: name,
  name,
  description,
  type,
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  injection_detected: false,
});

describe("filterSkills", () => {
  const all = [skill("branch-coverage", "New branches need tests", "rubric"), skill("flaky-tests", "Sleeps and timers")];

  it("returns everything for a blank query", () => {
    expect(filterSkills(all, "  ")).toEqual(all);
  });

  it("matches name, description or type, ignoring case", () => {
    expect(filterSkills(all, "BRANCH").map((x) => x.name)).toEqual(["branch-coverage"]);
    expect(filterSkills(all, "timers").map((x) => x.name)).toEqual(["flaky-tests"]);
    expect(filterSkills(all, "rubric").map((x) => x.name)).toEqual(["branch-coverage"]);
  });
});
