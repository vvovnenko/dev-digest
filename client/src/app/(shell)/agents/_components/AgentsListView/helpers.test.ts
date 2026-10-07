import { describe, it, expect } from "vitest";
import type { Agent } from "@devdigest/shared";
import { filterAgents } from "./helpers";

const agent = (name: string, description: string) => ({ id: name, name, description }) as Agent;
const AGENTS = [agent("Security Reviewer", "Flags secrets"), agent("Perf", "Finds N+1 queries")];

describe("filterAgents", () => {
  it("matches name or description, case-insensitively; blank search keeps all", () => {
    expect(filterAgents(AGENTS, "  ").map((a) => a.name)).toEqual(["Security Reviewer", "Perf"]);
    expect(filterAgents(AGENTS, "SECRET").map((a) => a.name)).toEqual(["Security Reviewer"]);
    expect(filterAgents(AGENTS, "n+1").map((a) => a.name)).toEqual(["Perf"]);
    expect(filterAgents(AGENTS, "nothing")).toEqual([]);
  });
});
