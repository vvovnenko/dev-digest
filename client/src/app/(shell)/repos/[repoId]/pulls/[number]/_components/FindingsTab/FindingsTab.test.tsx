/**
 * FindingsTab keyboard shortcuts across several open review runs: only the run
 * the user opened last listens, so one key press acts once (it used to act in
 * every open run). Deleting a run from the Timeline asks in a modal first.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../../messages/en/common.json";

const { mutate, deleteRun } = vi.hoisted(() => ({ mutate: vi.fn(), deleteRun: vi.fn() }));
vi.mock("@/lib/hooks/reviews", () => ({
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRun: () => ({ mutate: deleteRun, isPending: false }),
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
  deleteRun.mockReset();
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

const RUN: RunSummary = {
  run_id: "run-new",
  agent_id: "agent-new",
  agent_name: "Security",
  provider: "openrouter",
  model: "m",
  status: "done",
  error: null,
  duration_ms: 1000,
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: null,
  findings_count: 1,
  grounding: "1/1 passed",
  ran_at: "2026-09-28T10:00:00Z",
  score: 80,
  blockers: 0,
};

function renderTab(prRuns: RunSummary[] = []) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview: messages, common }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        lethalTrifecta={[]}
        reviews={REVIEWS}
        prRuns={prRuns}
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

describe("FindingsTab — deleting a run from the Timeline", () => {
  it("asks in a modal that holds the shortcuts; Cancel keeps the run, Delete removes it", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    deleteRun.mockImplementation((_id, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderTab([RUN]);

    await user.click(screen.getByRole("button", { name: "Delete run" }));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("This run and its logs will be permanently removed from the history.");
    await user.keyboard("a"); // the open run's `a` must not accept behind the modal
    expect(mutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteRun).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete run" }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteRun).toHaveBeenCalledWith("run-new", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
