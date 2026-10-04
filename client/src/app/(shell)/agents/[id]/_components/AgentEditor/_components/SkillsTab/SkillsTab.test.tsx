/**
 * Agent → Skills tab: every workspace skill in the agent's prompt order. Each user
 * action (tick, drop, keyboard drop) saves the whole ordered list exactly once;
 * nothing is saved on mount.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../../messages/en/skills.json";

const { mutate, push, state } = vi.hoisted(() => ({
  mutate: vi.fn(),
  push: vi.fn(),
  state: {
    skills: [] as Skill[] | undefined,
    links: [] as AgentSkillLink[] | undefined,
    loading: false,
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: state.skills, isLoading: state.loading, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentSkills: () => ({ data: state.links, isLoading: state.loading, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

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

beforeEach(() => {
  state.skills = [
    skill("s-branch", "branch-coverage"),
    skill("s-edge", "edge-case-checklist"),
    skill("s-mock", "mocking-discipline", { type: "convention", enabled: false }),
  ];
  state.links = [
    { agent_id: "ag1", skill_id: "s-edge", order: 0, enabled: true },
    { agent_id: "ag1", skill_id: "s-branch", order: 1, enabled: false },
  ];
  state.loading = false;
});
afterEach(() => {
  cleanup();
  mutate.mockReset();
  push.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, skills: skillsMessages }}>
      <SkillsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

const rowNames = () =>
  within(screen.getByRole("list", { name: "Skills" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".mono")?.textContent);
const sent = () => mutate.mock.calls[0]![0];

function dataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  };
}

describe("SkillsTab", () => {
  it("lists the agent's links in order, then the rest, with the enabled pill, and saves nothing on mount", () => {
    renderTab();
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "edge-case-checklist" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "branch-coverage" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Order matters — earlier skills appear earlier in the assembled prompt. Drag to reorder.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("marks a skill that is turned off on the Skills page", () => {
    renderTab();
    const row = screen.getByRole("checkbox", { name: "mocking-discipline" }).closest("li")!;
    expect(within(row).getByText("disabled globally")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open mocking-discipline" })).toHaveAttribute("href", "/skills/s-mock");
  });

  it("shows a blocked skill unchecked and disabled with the injection badge, and leaves it out of the pill", async () => {
    const user = userEvent.setup();
    state.skills = state.skills!.map((sk) => (sk.id === "s-edge" ? { ...sk, injection_detected: true } : sk));
    renderTab();
    const box = screen.getByRole("checkbox", { name: "edge-case-checklist" });
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toBeDisabled();
    const row = box.closest("li")!;
    expect(within(row).getByText("Injection detected")).toBeInTheDocument();
    expect(within(row).getByTitle("Prompt-injection patterns found — edit and save the skill to unblock it")).toBeInTheDocument();
    expect(row.style.border).toContain("var(--crit)");
    // Its link is still stored enabled, but it does not count.
    expect(screen.getByText("0 of 3 enabled")).toBeInTheDocument();
    await user.click(box);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("reordering keeps a blocked row's stored flag", () => {
    state.skills = state.skills!.map((sk) => (sk.id === "s-edge" ? { ...sk, injection_detected: true } : sk));
    renderTab();
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(sent()).toEqual([
      { skill_id: "s-mock", enabled: false },
      { skill_id: "s-edge", enabled: true },
      { skill_id: "s-branch", enabled: false },
    ]);
  });

  it("a tick saves the whole ordered list once, with the new flag", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("checkbox", { name: "mocking-discipline" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([
      { skill_id: "s-edge", enabled: true },
      { skill_id: "s-branch", enabled: false },
      { skill_id: "s-mock", enabled: true },
    ]);
  });

  it("dropping a row on another saves the reordered list once", () => {
    renderTab();
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent().map((l: { skill_id: string }) => l.skill_id)).toEqual(["s-mock", "s-edge", "s-branch"]);
    expect(screen.getByText("mocking-discipline moved to position 1 of 3.")).toBeInTheDocument();
  });

  it("dropping a row on itself saves nothing", () => {
    renderTab();
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.drop(rows[1]!, { dataTransfer: dt });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keyboard: Space lifts, arrows move, Space drops — one save", async () => {
    const user = userEvent.setup();
    renderTab();
    screen.getByRole("button", { name: "Reorder mocking-discipline" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(mutate).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(["mocking-discipline", "edge-case-checklist", "branch-coverage"]);
    await user.keyboard(" ");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent().map((l: { skill_id: string }) => l.skill_id)).toEqual(["s-mock", "s-edge", "s-branch"]);
  });

  it("keyboard: Escape puts the row back and saves nothing", async () => {
    const user = userEvent.setup();
    renderTab();
    screen.getByRole("button", { name: "Reorder branch-coverage" }).focus();
    await user.keyboard(" {ArrowDown}{Escape}");
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keyboard: moving focus to another control cancels the lift; a re-insert blur does not", async () => {
    const user = userEvent.setup();
    renderTab();
    const handle = screen.getByRole("button", { name: "Reorder edge-case-checklist" });
    handle.focus();
    await user.keyboard(" {ArrowDown}");
    fireEvent.blur(screen.getByRole("button", { name: "Reorder edge-case-checklist" }), { relatedTarget: null });
    expect(rowNames()).toEqual(["branch-coverage", "edge-case-checklist", "mocking-discipline"]);

    await user.tab();
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("filtering narrows the rows and turns reordering off, but ticks still save the full list", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.type(screen.getByRole("textbox", { name: "Filter skills…" }), "branch");
    expect(rowNames()).toEqual(["branch-coverage"]);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("draggable", "false");

    screen.getByRole("button", { name: "Reorder branch-coverage" }).focus();
    await user.keyboard(" {ArrowUp} ");
    expect(mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "branch-coverage" }));
    expect(sent()).toEqual([
      { skill_id: "s-edge", enabled: true },
      { skill_id: "s-branch", enabled: true },
      { skill_id: "s-mock", enabled: false },
    ]);
  });

  it("with no skills in the workspace, points to the Skills page", async () => {
    const user = userEvent.setup();
    state.skills = [];
    state.links = [];
    renderTab();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    await user.click(screen.getByText("Go to Skills"));
    expect(push).toHaveBeenCalledWith("/skills");
  });
});
