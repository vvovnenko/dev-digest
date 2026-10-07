import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Perf", model: "gpt-4.1-mini", enabled: false },
    ],
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutate, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });
});

describe("RunReviewDropdown — starting a review", () => {
  it("runs all enabled agents, or one agent (even a disabled one), and tells the page", async () => {
    const user = userEvent.setup();
    const onRunStart = vi.fn();
    renderWithIntl(<RunReviewDropdown prId="pr1" onRunStart={onRunStart} />);

    await user.click(screen.getByText("Run Review"));
    await user.click(screen.getByText("Run all enabled agents"));
    expect(mutate).toHaveBeenLastCalledWith({ prId: "pr1", all: true });

    await user.click(screen.getByText("Run Review"));
    expect(screen.getByText("gpt-4.1-mini · disabled")).toBeInTheDocument();
    await user.click(screen.getByText("Perf"));
    expect(mutate).toHaveBeenLastCalledWith({ prId: "pr1", agentId: "a2" });
    expect(onRunStart).toHaveBeenCalledTimes(2);
  });
});

