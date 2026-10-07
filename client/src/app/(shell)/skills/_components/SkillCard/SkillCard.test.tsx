import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import common from "../../../../../../messages/en/common.json";

const { update, del } = vi.hoisted(() => ({ update: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: update, isPending: false }),
  useDeleteSkill: () => ({ mutate: del, isPending: false }),
}));

import { SkillCard } from "./SkillCard";

afterEach(() => {
  cleanup();
  update.mockReset();
  del.mockReset();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply when the diff adds a branch.",
  type: "rubric",
  source: "imported",
  body: "## Rule",
  enabled: true,
  version: 3,
  injection_detected: false,
  agent_count: 2,
};

const ui = (props: Partial<React.ComponentProps<typeof SkillCard>> = {}) => (
  <NextIntlClientProvider locale="en" messages={{ skills: messages, common }}>
    <SkillCard skill={SKILL} {...props} />
  </NextIntlClientProvider>
);

describe("SkillCard", () => {
  it("shows the name, type, source, description, agent count and current version", () => {
    render(ui());
    expect(screen.getByText("branch-coverage")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("Apply when the diff adds a branch.")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("toggles the skill globally without opening it", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(ui({ onClick }));
    await user.click(screen.getByRole("switch", { name: "Enable branch-coverage" }));
    expect(update).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a blocked skill off with a disabled toggle, even when it is stored enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(ui({ onClick, skill: { ...SKILL, enabled: true, injection_detected: true } }));
    const toggle = screen.getByRole("switch", { name: "Enable branch-coverage" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(update).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens the skill from its name", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(ui({ onClick }));
    await user.click(screen.getByRole("button", { name: "Open branch-coverage" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("asks in a modal that names the agents it will be detached from", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(ui({ onClick }));
    await user.click(screen.getByRole("button", { name: "Delete skill" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete skill");
    expect(dialog).toHaveTextContent('"branch-coverage" will be permanently removed and detached from 2 agents.');
    expect(del).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("deletes on Delete, then closes the modal and reports it", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onDeleted = vi.fn();
    del.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    render(ui({ onClick, onDeleted, skill: { ...SKILL, agent_count: 0 } }));
    await user.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      '"branch-coverage" will be permanently removed. This cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).toHaveBeenCalledWith("s1", expect.anything());
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The modal sits beside the card, so its clicks never open the skill.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Cancel and the ✕ close the modal without deleting", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(ui({ onClick }));
    await user.click(screen.getByRole("button", { name: "Delete skill" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete skill" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
