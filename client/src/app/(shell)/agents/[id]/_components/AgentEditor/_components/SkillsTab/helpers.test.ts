import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import {
  countEnabled,
  filterRows,
  mergeAgentSkills,
  moveRow,
  sameRows,
  toggleRow,
  toLinks,
} from "./helpers";

const skill = (id: string, name: string, extra: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `${name} rule`,
  type: "rubric",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
  ...extra,
});
const link = (skill_id: string, order: number, enabled = true): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
  enabled,
});

const SKILLS = [skill("a", "zeta"), skill("b", "alpha"), skill("c", "mocking", { type: "convention" }), skill("d", "beta")];

describe("mergeAgentSkills", () => {
  it("puts the agent's links first in saved order, then never-linked skills by name", () => {
    const rows = mergeAgentSkills(SKILLS, [link("c", 1, false), link("a", 0)]);
    expect(rows.map((r) => [r.skill.id, r.enabled])).toEqual([
      ["a", true],
      ["c", false],
      ["b", false],
      ["d", false],
    ]);
  });

  it("drops a link whose skill no longer exists", () => {
    const rows = mergeAgentSkills(SKILLS, [link("gone", 0), link("b", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("row edits", () => {
  const rows = mergeAgentSkills(SKILLS, [link("a", 0), link("b", 1, false)]);

  it("toLinks sends every row in order with its flag", () => {
    expect(toLinks(rows)).toEqual([
      { skill_id: "a", enabled: true },
      { skill_id: "b", enabled: false },
      { skill_id: "d", enabled: false },
      { skill_id: "c", enabled: false },
    ]);
  });

  it("moveRow moves one item and ignores out-of-range moves", () => {
    expect(moveRow(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveRow(["a", "b", "c"], 2, 3)).toEqual(["a", "b", "c"]);
  });

  it("toggleRow flips one flag and keeps positions", () => {
    const next = toggleRow(rows, "b");
    expect(next.map((r) => [r.skill.id, r.enabled])).toEqual([
      ["a", true],
      ["b", true],
      ["d", false],
      ["c", false],
    ]);
    expect(countEnabled(next)).toBe(2);
    expect(sameRows(next, rows)).toBe(false);
    expect(sameRows(toggleRow(next, "b"), rows)).toBe(true);
  });

  it("filterRows matches name, description or type, case-insensitively", () => {
    expect(filterRows(rows, "  MOCK ").map((r) => r.skill.id)).toEqual(["c"]);
    expect(filterRows(rows, "convention").map((r) => r.skill.id)).toEqual(["c"]);
    expect(filterRows(rows, "alpha rule").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "")).toHaveLength(4);
  });
});
