import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

const mutate = vi.hoisted(() => vi.fn());

// Mock the data hooks so the tab renders without a network/query client.
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: (provider: string) => ({
    data: provider === "openai" ? [{ id: "gpt-4.1", provider: "openai" }] : [{ id: "claude-x", provider }],
  }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

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

const ui = (agent: Agent) => (
  <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
    <ToastProvider>
      <ConfigTab agent={agent} />
    </ToastProvider>
  </NextIntlClientProvider>
);

const saveButton = () => screen.getByText("Save agent").closest("button")!;
const sentPatch = () => mutate.mock.calls[0]![0].patch;
const providerSelect = () =>
  screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "openai")!;

describe("ConfigTab", () => {
  it("saves only the fields the user changed", async () => {
    const user = userEvent.setup();
    render(ui(AGENT));
    const name = screen.getByDisplayValue("Security Reviewer");
    await user.clear(name);
    await user.type(name, "Sec Reviewer 2");
    await user.click(saveButton());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ id: "ag1", patch: { name: "Sec Reviewer 2" } });
  });

  it("shows, and never undoes, an enabled change made from the list meanwhile", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui(AGENT));
    // The agents list toggles the agent off; the cache hands the tab the new agent.
    rerender(ui({ ...AGENT, enabled: false }));
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");

    const description = screen.getByDisplayValue("Flags secrets and injection");
    await user.clear(description);
    await user.type(description, "New description");
    await user.click(saveButton());
    expect(sentPatch()).toEqual({ description: "New description" });
    expect(sentPatch()).not.toHaveProperty("enabled");
  });

  it("follows the list's toggle after Enabled is switched off and back on, and Save doesn't undo it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui(AGENT));
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    await user.click(toggle);
    await user.click(toggle);
    // The list's toggle saves enabled: false and the cache hands it down.
    rerender(ui({ ...AGENT, enabled: false }));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(saveButton());
    expect(sentPatch()).toEqual({});
    rerender(ui({ ...AGENT, enabled: true }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("drops an unsaved Enabled change once the list's toggle saves the same value", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui(AGENT));
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    await user.click(toggle);
    rerender(ui({ ...AGENT, enabled: false }));
    rerender(ui({ ...AGENT, enabled: true }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(saveButton());
    expect(sentPatch()).toEqual({});
  });

  it("clears the model when the provider changes and waits for a new one before saving", async () => {
    const user = userEvent.setup();
    render(ui(AGENT));
    await user.selectOptions(providerSelect(), "anthropic");
    expect(saveButton()).toBeDisabled();

    // Switching back restores the saved model.
    await user.selectOptions(
      screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "anthropic")!,
      "openai",
    );
    expect(saveButton()).not.toBeDisabled();
  });
});
