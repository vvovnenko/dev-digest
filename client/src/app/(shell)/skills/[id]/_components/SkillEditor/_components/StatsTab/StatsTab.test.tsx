import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillAgentUse } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";

const agents = vi.hoisted(() => ({ data: [] as SkillAgentUse[] }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkillAgents: () => ({ data: agents.data, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { StatsTab } from "./StatsTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "",
  type: "rubric",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  injection_detected: false,
};

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );

describe("StatsTab", () => {
  it("counts the agents using the skill and links each one's Skills tab", () => {
    agents.data = [
      { agent_id: "a1", agent_name: "Test Quality Reviewer", agent_enabled: true, order: 0 },
      { agent_id: "a2", agent_name: "General Reviewer", agent_enabled: false, order: 2 },
    ];
    renderTab();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Test Quality Reviewer" })).toHaveAttribute(
      "href",
      "/agents/a1?tab=skills",
    );
    expect(screen.getByText("agent disabled")).toBeInTheDocument();
  });

  it("explains how to attach it when no agent uses it", () => {
    agents.data = [];
    renderTab();
    expect(screen.getByText(/No agent uses this skill yet/)).toBeInTheDocument();
  });
});
