import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import {
  countEnabled,
  filterRows,
  isRowLive,
  mergeAgentSkills,
  moveRow,
  nextLiveIndex,
  sameRows,
  toggleRow,
  toLinks,
  type SkillRow,
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
  injection_detected: false,
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
  it("puts the agent's live links first in saved order, then every other skill by name", () => {
    const rows = mergeAgentSkills(SKILLS, [link("c", 1, false), link("a", 0)]);
    expect(rows.map((r) => [r.skill.id, r.enabled])).toEqual([
      ["a", true],
      ["b", false],
      ["d", false],
      ["c", false],
    ]);
  });

  it("lifts live links saved below links that are off, keeping their saved order", () => {
    const rows = mergeAgentSkills(SKILLS, [link("b", 0, false), link("d", 1, false), link("c", 2), link("a", 3)]);
    expect(rows.map((r) => [r.skill.id, r.enabled])).toEqual([
      ["c", true],
      ["a", true],
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

  it("toggleRow puts a row turned on at the end of the live block", () => {
    const next = toggleRow(rows, "c");
    expect(next.map((r) => [r.skill.id, r.enabled])).toEqual([
      ["a", true],
      ["c", true],
      ["b", false],
      ["d", false],
    ]);
    expect(countEnabled(next)).toBe(2);
    expect(sameRows(next, rows)).toBe(false);
    expect(sameRows(toggleRow(next, "c"), rows)).toBe(true);
  });

  it("toggleRow puts a row turned off back among the rest by name", () => {
    const live = mergeAgentSkills(SKILLS, [link("a", 0), link("c", 1), link("b", 2)]);
    expect(live.map((r) => r.skill.id)).toEqual(["a", "c", "b", "d"]);
    expect(toggleRow(live, "c").map((r) => [r.skill.id, r.enabled])).toEqual([
      ["a", true],
      ["b", true],
      ["d", false],
      ["c", false],
    ]);
  });

  it("a blocked skill's row is not live, can't be toggled and keeps its stored flag", () => {
    const flagged = mergeAgentSkills(
      SKILLS.map((sk) => (sk.id === "a" ? { ...sk, injection_detected: true } : sk)),
      [link("a", 0), link("b", 1)],
    );
    // a (zeta) is blocked, so it sorts by name among the rows that are off.
    expect(flagged.map((r) => r.skill.id)).toEqual(["b", "d", "c", "a"]);
    expect(flagged.map(isRowLive)).toEqual([true, false, false, false]);
    expect(countEnabled(flagged)).toBe(1);
    expect(sameRows(toggleRow(flagged, "a"), flagged)).toBe(true);
    expect(toLinks(flagged).at(-1)).toEqual({ skill_id: "a", enabled: true });
  });

  it("nextLiveIndex steps over rows that are not live, and stays put at either end", () => {
    // a (live), b and d (off), c (live) — built by hand: mergeAgentSkills never leaves a gap.
    const byId = new Map(SKILLS.map((sk) => [sk.id, sk]));
    const withGap: SkillRow[] = [
      { skill: byId.get("a")!, enabled: true },
      { skill: byId.get("b")!, enabled: false },
      { skill: byId.get("d")!, enabled: false },
      { skill: byId.get("c")!, enabled: true },
    ];
    expect(withGap.map(isRowLive)).toEqual([true, false, false, true]);
    expect(nextLiveIndex(withGap, 0, 1)).toBe(3);
    expect(nextLiveIndex(withGap, 3, -1)).toBe(0);
    expect(nextLiveIndex(withGap, 0, -1)).toBe(0);
    expect(nextLiveIndex(withGap, 3, 1)).toBe(3);
  });

  it("filterRows matches name, description or type, case-insensitively", () => {
    expect(filterRows(rows, "  MOCK ").map((r) => r.skill.id)).toEqual(["c"]);
    expect(filterRows(rows, "convention").map((r) => r.skill.id)).toEqual(["c"]);
    expect(filterRows(rows, "alpha rule").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "")).toHaveLength(4);
  });
});
