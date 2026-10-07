import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import common from "../../../../../../messages/en/common.json";

const { del } = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@/lib/hooks/agents", () => ({
  useDeleteAgent: () => ({ mutate: del, isPending: false }),
}));

import { AgentCard } from "./AgentCard";

afterEach(() => {
  cleanup();
  del.mockReset();
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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, common }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("asks in a modal before deleting, then deletes and closes it", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    del.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    renderWithIntl(<AgentCard ag={AGENT} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete agent");
    expect(dialog).toHaveTextContent('"Security Reviewer" will be permanently removed. This cannot be undone.');
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).toHaveBeenCalledWith("ag1", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Cancel closes the modal without deleting", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(<AgentCard ag={AGENT} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
