import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply when the diff adds a branch.",
  type: "rubric",
  source: "manual",
  body: "## Rule",
  enabled: true,
  version: 2,
  injection_detected: false,
};

const ui = (skill: Skill = SKILL) => (
  <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
    <ToastProvider>
      <ConfigTab skill={skill} />
    </ToastProvider>
  </NextIntlClientProvider>
);

const saveButton = () => screen.getByRole("button", { name: /Save skill/ });

describe("ConfigTab (skill)", () => {
  it("sends only the fields that changed", async () => {
    const user = userEvent.setup();
    render(ui());
    expect(saveButton()).toBeDisabled();
    const description = screen.getByLabelText("Description");
    await user.clear(description);
    await user.type(description, "Apply to every new branch.");
    await user.click(saveButton());
    expect(mutate.mock.calls[0]![0]).toEqual({ id: "s1", patch: { description: "Apply to every new branch." } });
  });

  it("does not send a field typed back to its saved value", async () => {
    const user = userEvent.setup();
    render(ui());
    const name = screen.getByLabelText("Name");
    await user.type(name, "-x");
    await user.type(name, "{Backspace}{Backspace}");
    expect(saveButton()).toBeDisabled();
  });

  it("counts the tokens of the block the agent receives, live", async () => {
    const user = userEvent.setup();
    render(ui());
    // "### branch-coverage\nWhen to apply: Apply when the diff adds a branch.\n\n## Rule" = 78 chars → 20
    expect(screen.getByText("20 tokens")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Skill body, Markdown"), "1234");
    expect(screen.getByText("21 tokens")).toBeInTheDocument();
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("refuses an invalid name and clears the draft on Cancel", async () => {
    const user = userEvent.setup();
    render(ui());
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Bad Name");
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Name")).toHaveValue("branch-coverage");
  });

  it("shows the Enabled toggle off and disabled while the skill is blocked", async () => {
    const user = userEvent.setup();
    render(ui({ ...SKILL, enabled: true, injection_detected: true }));
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(saveButton()).toBeDisabled();
  });

  it("a clean skill's Enabled toggle still edits the draft", async () => {
    const user = userEvent.setup();
    render(ui());
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await user.click(saveButton());
    expect(mutate.mock.calls[0]![0]).toEqual({ id: "s1", patch: { enabled: false } });
  });

  it("follows the list's toggle after Enabled is switched off and back on", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui());
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    await user.click(toggle);
    await user.click(toggle);
    // The list's toggle saves enabled: false and the cache hands it down.
    rerender(ui({ ...SKILL, enabled: false }));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(saveButton()).toBeDisabled();
    rerender(ui({ ...SKILL, enabled: true }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("drops an unsaved Enabled change once the list's toggle saves the same value", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui());
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    await user.click(toggle);
    expect(saveButton()).toBeEnabled();
    rerender(ui({ ...SKILL, enabled: false }));
    expect(saveButton()).toBeDisabled();
    rerender(ui({ ...SKILL, enabled: true }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(saveButton()).toBeDisabled();
  });

  it("marks the name on a 409", async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_input, opts) => opts.onError(new ApiError("taken", 409, "conflict")));
    render(ui());
    await user.type(screen.getByLabelText("Name"), "-2");
    await user.click(saveButton());
    expect(screen.getByText("A skill with this name already exists.")).toBeInTheDocument();
  });
});
