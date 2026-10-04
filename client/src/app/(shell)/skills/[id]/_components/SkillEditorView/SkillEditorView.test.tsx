import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const { push, replace, nav, data } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  nav: { search: "tab=bogus" },
  data: { skill: undefined as Skill | undefined },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ id: "s1" }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: data.skill ? [data.skill] : [] }),
  useSkill: () => ({ data: data.skill, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewSkillImport: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillAgents: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { SkillEditorView } from "./SkillEditorView";

afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
  nav.search = "tab=bogus";
});

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply when the diff adds a branch.",
  type: "rubric",
  source: "manual",
  body: "## Rule\nFlag it.",
  enabled: false,
  version: 3,
  agent_count: 1,
};

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditorView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("SkillEditorView", () => {
  it("falls back to the Preview tab for an unknown ?tab=", () => {
    data.skill = SKILL;
    renderView();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "branch-coverage" })).toBeInTheDocument();
    expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("falls back to the Preview tab for ?tab=stats (Stats is hidden)", () => {
    data.skill = SKILL;
    nav.search = "tab=stats";
    renderView();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
  });

  it("switches tabs through the URL, keeping other params", async () => {
    const user = userEvent.setup();
    data.skill = SKILL;
    nav.search = "tab=preview&x=1";
    renderView();
    await user.click(screen.getByRole("button", { name: "Versions" }));
    expect(replace).toHaveBeenCalledWith("/skills/s1?tab=versions&x=1");
  });

  it("shows an error when the skill does not exist", () => {
    data.skill = undefined;
    renderView();
    expect(screen.getByText("Could not load this skill")).toBeInTheDocument();
  });
});
