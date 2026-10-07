import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";

const { push, state } = vi.hoisted(() => ({
  push: vi.fn(),
  state: { skills: undefined as Skill[] | undefined, isLoading: false, isError: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: state.skills, isLoading: state.isLoading, isError: state.isError, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewSkillImport: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useImportSkillFromUrl: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  push.mockReset();
  state.skills = undefined;
  state.isLoading = false;
  state.isError = false;
});

const skill = (id: string, name: string, description = ""): Skill => ({
  id,
  name,
  description,
  type: "custom",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  injection_detected: false,
  agent_count: 0,
});

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView />
    </NextIntlClientProvider>,
  );

describe("SkillsListView", () => {
  it("lists every skill and opens one on its Preview tab", async () => {
    const user = userEvent.setup();
    state.skills = [skill("s1", "branch-coverage"), skill("s2", "mocking-discipline")];
    renderView();
    expect(screen.getByText("mocking-discipline")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open branch-coverage" }));
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=preview");
  });

  it("filters by the search box", async () => {
    const user = userEvent.setup();
    state.skills = [skill("s1", "branch-coverage", "new branches"), skill("s2", "flaky-tests", "timers")];
    renderView();
    await user.type(screen.getByLabelText("Search skills…"), "timers");
    expect(screen.queryByText("branch-coverage")).not.toBeInTheDocument();
    expect(screen.getByText("flaky-tests")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search skills…"));
    await user.type(screen.getByLabelText("Search skills…"), "nothing-like-it");
    expect(screen.getByText('No skill matches "nothing-like-it".')).toBeInTheDocument();
  });

  it("shows the empty state when there are no skills", () => {
    state.skills = [];
    renderView();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("offers create and import from Add Skill", async () => {
    const user = userEvent.setup();
    state.skills = [];
    renderView();
    await user.click(screen.getByRole("button", { name: /Add Skill/ }));
    expect(screen.getByText("Create from scratch")).toBeInTheDocument();
    await user.click(screen.getByText("Import file…"));
    expect(screen.getByText("Import a skill")).toBeInTheDocument();
  });
});
