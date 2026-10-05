/**
 * Agent → Skills tab: every workspace skill in the agent's prompt order. Each user
 * action (toggle, drop, keyboard drop) saves the whole ordered list exactly once;
 * nothing is saved on mount. Only enabled (live) rows can be moved, and they stay
 * one block on top, so any of them can reach position 1.
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
  it("lists the enabled skills first, then the rest by name, with the enabled pill, and saves nothing on mount", () => {
    renderTab();
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "edge-case-checklist" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "branch-coverage" })).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Order matters — earlier skills appear earlier in the assembled prompt. Drag an enabled skill to reorder."),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows an enabled skill saved below skills that are off on top, and it can be dropped to position 1", () => {
    state.links = [
      { agent_id: "ag1", skill_id: "s-branch", order: 0, enabled: false },
      { agent_id: "ag1", skill_id: "s-mock", order: 1, enabled: true },
      { agent_id: "ag1", skill_id: "s-edge", order: 2, enabled: true },
    ];
    renderTab();
    expect(rowNames()).toEqual(["mocking-discipline", "edge-case-checklist", "branch-coverage"]);
    expect(mutate).not.toHaveBeenCalled();

    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(sent()).toEqual([
      { skill_id: "s-edge", enabled: true },
      { skill_id: "s-mock", enabled: true },
      { skill_id: "s-branch", enabled: false },
    ]);
  });

  it("marks a skill that is turned off on the Skills page", () => {
    renderTab();
    const row = screen.getByRole("switch", { name: "mocking-discipline" }).closest("li")!;
    expect(within(row).getByText("disabled globally")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open mocking-discipline" })).toHaveAttribute("href", "/skills/s-mock");
  });

  it("shows a blocked skill unchecked and disabled with the injection badge, and leaves it out of the pill", async () => {
    const user = userEvent.setup();
    state.skills = state.skills!.map((sk) => (sk.id === "s-edge" ? { ...sk, injection_detected: true } : sk));
    renderTab();
    const box = screen.getByRole("switch", { name: "edge-case-checklist" });
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
    state.links = [
      { agent_id: "ag1", skill_id: "s-edge", order: 0, enabled: true },
      { agent_id: "ag1", skill_id: "s-branch", order: 1, enabled: true },
      { agent_id: "ag1", skill_id: "s-mock", order: 2, enabled: true },
    ];
    renderTab();
    // The blocked edge-case-checklist sorts below the two live rows.
    expect(rowNames()).toEqual(["branch-coverage", "mocking-discipline", "edge-case-checklist"]);
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(sent()).toEqual([
      { skill_id: "s-mock", enabled: true },
      { skill_id: "s-branch", enabled: true },
      { skill_id: "s-edge", enabled: true },
    ]);
  });

  it("a toggle moves the skill it turns on to the end of the enabled block and saves the list once", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("switch", { name: "mocking-discipline" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([
      { skill_id: "s-edge", enabled: true },
      { skill_id: "s-mock", enabled: true },
      { skill_id: "s-branch", enabled: false },
    ]);
  });

  it("dropping an enabled row on another saves the reordered list once", () => {
    state.links = [...state.links!, { agent_id: "ag1", skill_id: "s-mock", order: 2, enabled: true }];
    renderTab();
    expect(rowNames()).toEqual(["edge-case-checklist", "mocking-discipline", "branch-coverage"]);
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent().map((l: { skill_id: string }) => l.skill_id)).toEqual(["s-mock", "s-edge", "s-branch"]);
    expect(screen.getByText("mocking-discipline moved to position 1 of 3.")).toBeInTheDocument();
  });

  it("only enabled rows can be dragged or take a drop", () => {
    renderTab();
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    // edge-case-checklist is on; branch-coverage is linked but off; mocking-discipline is not linked.
    expect(rows.map((li) => li.getAttribute("draggable"))).toEqual(["true", "false", "false"]);
    const handle = screen.getByRole("button", { name: "Reorder branch-coverage" });
    expect(handle).toHaveAttribute("aria-disabled", "true");
    expect(handle).toHaveAttribute("title", "Enable the skill to reorder it");

    const dt = dataTransfer();
    fireEvent.dragStart(rows[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    const dt2 = dataTransfer();
    fireEvent.dragStart(rows[0]!, { dataTransfer: dt2 });
    fireEvent.dragOver(rows[1]!, { dataTransfer: dt2 });
    fireEvent.drop(rows[1]!, { dataTransfer: dt2 });
    expect(mutate).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
  });

  it("dropping a row on itself saves nothing", () => {
    renderTab();
    const rows = within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.drop(rows[1]!, { dataTransfer: dt });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keyboard: Space lifts, arrows move within the enabled block, Space drops — one save", async () => {
    const user = userEvent.setup();
    state.links = [...state.links!, { agent_id: "ag1", skill_id: "s-mock", order: 2, enabled: true }];
    renderTab();
    expect(rowNames()).toEqual(["edge-case-checklist", "mocking-discipline", "branch-coverage"]);
    screen.getByRole("button", { name: "Reorder mocking-discipline" }).focus();
    await user.keyboard(" ");
    // ArrowDown stops at the end of the enabled block: branch-coverage below is off.
    await user.keyboard("{ArrowDown}");
    expect(rowNames()).toEqual(["edge-case-checklist", "mocking-discipline", "branch-coverage"]);
    await user.keyboard("{ArrowUp}");
    expect(rowNames()).toEqual(["mocking-discipline", "edge-case-checklist", "branch-coverage"]);
    await user.keyboard("{ArrowUp}");
    expect(mutate).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(["mocking-discipline", "edge-case-checklist", "branch-coverage"]);
    await user.keyboard(" ");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sent().map((l: { skill_id: string }) => l.skill_id)).toEqual(["s-mock", "s-edge", "s-branch"]);
  });

  it("keyboard: a row that is off can't be picked up", async () => {
    const user = userEvent.setup();
    renderTab();
    const handle = screen.getByRole("button", { name: "Reorder branch-coverage" });
    handle.focus();
    await user.keyboard(" {ArrowUp} ");
    expect(handle).toHaveAttribute("aria-pressed", "false");
    expect(rowNames()).toEqual(["edge-case-checklist", "branch-coverage", "mocking-discipline"]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keyboard: Escape puts the row back and saves nothing", async () => {
    const user = userEvent.setup();
    state.links = [...state.links!, { agent_id: "ag1", skill_id: "s-mock", order: 2, enabled: true }];
    renderTab();
    screen.getByRole("button", { name: "Reorder edge-case-checklist" }).focus();
    await user.keyboard(" {ArrowDown}");
    expect(rowNames()).toEqual(["mocking-discipline", "edge-case-checklist", "branch-coverage"]);
    await user.keyboard("{Escape}");
    expect(rowNames()).toEqual(["edge-case-checklist", "mocking-discipline", "branch-coverage"]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keyboard: moving focus to another control cancels the lift; a re-insert blur does not", async () => {
    const user = userEvent.setup();
    state.links = [
      { agent_id: "ag1", skill_id: "s-edge", order: 0, enabled: true },
      { agent_id: "ag1", skill_id: "s-branch", order: 1, enabled: true },
    ];
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

  it("filtering narrows the rows and turns reordering off, but toggles still save the full list", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.type(screen.getByRole("textbox", { name: "Filter skills…" }), "edge");
    expect(rowNames()).toEqual(["edge-case-checklist"]);
    // edge-case-checklist is on, so only the filter keeps it from moving.
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("draggable", "false");
    const handle = screen.getByRole("button", { name: "Reorder edge-case-checklist" });
    expect(handle).toHaveAttribute("title", "Clear the filter to reorder");

    handle.focus();
    await user.keyboard(" {ArrowDown} ");
    expect(handle).toHaveAttribute("aria-pressed", "false");
    expect(mutate).not.toHaveBeenCalled();

    // Turned off, edge-case-checklist goes back among the rest by name.
    await user.click(screen.getByRole("switch", { name: "edge-case-checklist" }));
    expect(sent()).toEqual([
      { skill_id: "s-branch", enabled: false },
      { skill_id: "s-edge", enabled: false },
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
