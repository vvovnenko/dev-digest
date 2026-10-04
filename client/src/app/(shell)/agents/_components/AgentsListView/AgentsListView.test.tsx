/** The agents list shows each card's enabled-skill count (`Agent.skill_count`). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "Uncovered branches, corner cases, over-mocking, flakes",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  system_prompt: "You review tests.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 3,
};
const OLD: Agent = { ...AGENT, id: "ag2", name: "General Reviewer", skill_count: null };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ useShellCrumb: vi.fn() }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [AGENT, OLD], isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentsListView } from "./AgentsListView";

afterEach(cleanup);

describe("AgentsListView — skill count", () => {
  it("shows the enabled-skill count on a card, and nothing when the API sent none", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentsListView />
      </NextIntlClientProvider>,
    );
    const card = (name: string) => screen.getByRole("button", { name: `Open ${name}` }).parentElement!.parentElement!;
    expect(within(card("Test Quality Reviewer")).getByText("3 skills")).toBeInTheDocument();
    expect(within(card("General Reviewer")).queryByText(/skills?$/)).not.toBeInTheDocument();
  });
});
