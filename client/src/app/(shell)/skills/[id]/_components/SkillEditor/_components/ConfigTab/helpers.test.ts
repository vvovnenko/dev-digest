import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { changedFields, mergeDraft } from "./helpers";

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply to new branches.",
  type: "rubric",
  source: "manual",
  body: "## Rule",
  enabled: true,
  version: 2,
  injection_detected: false,
};

describe("changedFields", () => {
  it("keeps only values that differ from the saved skill", () => {
    expect(changedFields(SKILL, {})).toEqual({});
    expect(changedFields(SKILL, { name: "branch-coverage", body: "## New" })).toEqual({ body: "## New" });
    expect(changedFields(SKILL, { enabled: false, type: "rubric" })).toEqual({ enabled: false });
  });
});

describe("mergeDraft", () => {
  it("lays the draft over the skill", () => {
    expect(mergeDraft(SKILL, { description: "x" })).toEqual({
      name: "branch-coverage",
      description: "x",
      type: "rubric",
      body: "## Rule",
      enabled: true,
    });
  });
});
