import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const setSkills = vi.hoisted(() => vi.fn());

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({
    data: [{ agent_id: "ag1", skill_id: "s1", order: 0, enabled: true }],
    isLoading: false,
    isError: false,
  }),
  useSetAgentSkills: () => ({ mutate: setSkills, isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      {
        id: "s1",
        name: "branch-coverage",
        description: "Apply to new branches.",
        type: "rubric",
        source: "manual",
        body: "Flag uncovered branches.",
        enabled: true,
        version: 1,
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillsMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("renders the Skills tab without saving anything", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByText("1 of 1 enabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "branch-coverage" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Configuration")).not.toBeVisible();
    expect(setSkills).not.toHaveBeenCalled();
  });

  it("keeps an unsaved Config draft across a visit to the Skills tab", async () => {
    const user = userEvent.setup();
    const ui = (tab: string) => <AgentEditor agent={AGENT} tab={tab} onTab={() => {}} />;
    const { rerender } = renderWithIntl(ui("config"));
    const name = screen.getByDisplayValue("Security Reviewer");
    await user.clear(name);
    await user.type(name, "Draft name");

    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillsMessages }}>
        <ToastProvider>{ui("skills")}</ToastProvider>
      </NextIntlClientProvider>,
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillsMessages }}>
        <ToastProvider>{ui("config")}</ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByDisplayValue("Draft name")).toBeVisible();
  });
});
