/**
 * FindingsTab keyboard shortcuts across several open review runs: only the run
 * the user opened last listens, so one key press acts once (it used to act in
 * every open run).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/reviews", () => ({
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useRunSettled: () => vi.fn(),
  useFindingAction: () => ({ mutate, isPending: false }),
  usePendingFindingIds: () => new Set<string>(),
  useRunEvents: () => ({ events: [], running: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const finding = (id: string, reviewId: string): FindingRecord => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: `Finding ${id}`,
  file: "src/a.ts",
  start_line: 1,
  end_line: 1,
  rationale: "r",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: reviewId,
  accepted_at: null,
  dismissed_at: null,
});

const review = (id: string, agent: string, findingId: string): ReviewRecord => ({
  id,
  pr_id: "pr1",
  agent_id: `agent-${id}`,
  run_id: `run-${id}`,
  agent_name: agent,
  kind: "review",
  verdict: "comment",
  summary: "s",
  score: 80,
  model: "m",
  created_at: "2026-09-28T10:00:00Z",
  findings: [finding(findingId, id)],
});

// Newest first, as the page passes them.
const REVIEWS = [review("new", "Security", "f-new"), review("old", "Perf", "f-old")];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        lethalTrifecta={[]}
        reviews={REVIEWS}
        prRuns={[]}
        prCommits={[]}
        onOpenTrace={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

const header = (agent: string) => screen.getByRole("button", { name: new RegExp(`^${agent}`) });

describe("FindingsTab — one run drives the shortcuts", () => {
  it("opens the newest run; with a second run opened, `a` accepts once, in the run opened last", async () => {
    const user = userEvent.setup();
    const { container } = renderTab();
    expect(header("Security")).toHaveAttribute("aria-expanded", "true");
    expect(header("Perf")).toHaveAttribute("aria-expanded", "false");

    await user.click(header("Perf"));
    expect(container.querySelectorAll("[data-finding-id]")).toHaveLength(2); // both runs open

    await user.keyboard("a");
    expect(mutate.mock.calls.map(([arg]) => arg)).toEqual([{ findingId: "f-old", action: "accept" }]);
  });

  it("closing the run that held the shortcuts hands them to the run still open", async () => {
    const user = userEvent.setup();
    const { container } = renderTab();
    await user.click(header("Perf"));
    await user.click(header("Perf"));
    expect(within(container).queryByText("Finding f-old")).not.toBeInTheDocument();

    await user.keyboard("a");
    expect(mutate.mock.calls.map(([arg]) => arg)).toEqual([{ findingId: "f-new", action: "accept" }]);
  });
});
