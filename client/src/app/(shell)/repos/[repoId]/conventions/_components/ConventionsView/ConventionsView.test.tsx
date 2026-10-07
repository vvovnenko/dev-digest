/**
 * The Conventions page: "Run scan" before the first scan and "Re-scan" after it
 * (two separate buttons), the sample-file subtitle, "N of M accepted", "Create
 * skill" only once a candidate is accepted, Deselect all, and the background
 * scan: "Scanning…" and the locks follow the newest scan's status (not only the
 * click), with a queued / running / failed line under the subtitle.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionScan, ConventionsState } from "@devdigest/shared";
import conventions from "../../../../../../../../messages/en/conventions.json";
import skills from "../../../../../../../../messages/en/skills.json";
import common from "../../../../../../../../messages/en/common.json";

const { hooks, state } = vi.hoisted(() => ({
  hooks: { extract: vi.fn(), deselect: vi.fn(), update: vi.fn() },
  state: {
    data: undefined as ConventionsState | undefined,
    isLoading: false,
    scanning: false,
    repoNotFound: false,
  },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { name: "payments-api", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => state.repoNotFound,
}));
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({ data: state.data, isLoading: state.isLoading, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: hooks.extract, isPending: state.scanning }),
  useDeselectAllConventions: () => ({ mutate: hooks.deselect, isPending: false }),
  useUpdateConvention: () => ({ mutate: hooks.update, isPending: false }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
  useCreateConventionSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

const candidate = (id: string, status: ConventionCandidate["status"] = "pending"): ConventionCandidate => ({
  id,
  category: "naming",
  rule: `Rule ${id}`,
  evidence_path: "src/a.ts",
  evidence_start_line: 3,
  evidence_end_line: 9,
  evidence_snippet: `snippet ${id}`,
  confidence: 0.8,
  status,
  accepted: status === "accepted",
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const scanned = (candidates: ConventionCandidate[]): ConventionsState => {
  const scan: ConventionScan = {
    id: "scan1",
    status: "done",
    sample_files: Array.from({ length: 14 }, (_, i) => `src/f${i}.ts`),
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    candidates_found: 5,
    candidates_kept: candidates.length,
    created_at: minutesAgo(5),
  };
  return { scan, latest_scan: scan, candidates };
};

const NO_SCAN: ConventionsState = { scan: null, latest_scan: null, candidates: [] };

/** `base` with a newer scan in `status` as its newest one. */
const withLatest = (
  base: ConventionsState,
  status: ConventionScan["status"],
  extra: Partial<ConventionScan> = {},
): ConventionsState => ({
  ...base,
  latest_scan: {
    id: "scan2",
    status,
    sample_files: [],
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    candidates_found: 0,
    candidates_kept: 0,
    created_at: minutesAgo(1),
    ...extra,
  },
});

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.scanning = false;
  state.repoNotFound = false;
});
afterEach(() => {
  cleanup();
  for (const fn of Object.values(hooks)) fn.mockReset();
});

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ conventions, skills, common }}>
      <ConventionsView />
    </NextIntlClientProvider>,
  );

describe("ConventionsView", () => {
  it("offers Run scan before the first scan, and no Re-scan", async () => {
    const user = userEvent.setup();
    state.data = NO_SCAN;
    renderView();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Conventions in payments-api");
    expect(screen.queryByRole("button", { name: "Re-scan" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run scan" }));
    expect(hooks.extract).toHaveBeenCalledWith("r1");
  });

  it("shows Scanning… while the first scan is being started", () => {
    state.data = NO_SCAN;
    state.scanning = true;
    renderView();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("shows Scanning… for a first scan already in flight (after a reload, or from another tab)", () => {
    state.data = withLatest(NO_SCAN, "queued");
    renderView();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run scan" })).not.toBeInTheDocument();
    expect(screen.getByText("Scan queued…")).toBeInTheDocument();
  });

  it("says why the first scan failed, and Run scan still works", async () => {
    const user = userEvent.setup();
    state.data = withLatest(NO_SCAN, "failed", { error: "The model returned no conventions" });
    renderView();
    expect(screen.getByText("Last scan failed: The model returned no conventions")).toBeInTheDocument();
    expect(screen.getByText("No conventions yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run scan" }));
    expect(hooks.extract).toHaveBeenCalledWith("r1");
  });

  it("after a scan: Re-scan, the sample count and the accepted count", async () => {
    const user = userEvent.setup();
    state.data = scanned([candidate("c1", "accepted"), candidate("c2"), candidate("c3")]);
    renderView();
    expect(screen.queryByRole("button", { name: "Run scan" })).not.toBeInTheDocument();
    expect(screen.getByText("Detected from 14 sample files · last scan 5 minutes ago")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 accepted")).toBeInTheDocument();
    expect(screen.getAllByText(/^Rule c/)).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(hooks.extract).toHaveBeenCalledWith("r1");
  });

  it("shows Create skill only once a candidate is accepted", async () => {
    const user = userEvent.setup();
    state.data = scanned([candidate("c1"), candidate("c2")]);
    renderView();
    expect(screen.queryByRole("button", { name: "Create skill" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect all" })).toBeDisabled();
    cleanup();

    state.data = scanned([candidate("c1", "accepted"), candidate("c2")]);
    renderView();
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Create skill from conventions");
  });

  it("deselects every accepted candidate", async () => {
    const user = userEvent.setup();
    state.data = scanned([candidate("c1", "accepted"), candidate("c2", "accepted")]);
    renderView();
    await user.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(hooks.deselect).toHaveBeenCalledWith("r1");
  });

  it("locks the cards and Deselect all while a re-scan is being started", () => {
    state.data = scanned([candidate("c1", "accepted")]);
    state.scanning = true;
    renderView();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accepted" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deselect all" })).toBeDisabled();
  });

  it("derives Scanning… and the locks from a running scan, and keeps the last scan's subtitle and cards", () => {
    state.data = withLatest(scanned([candidate("c1", "accepted")]), "running", { started_at: minutesAgo(2) });
    renderView();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accepted" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deselect all" })).toBeDisabled();
    expect(screen.getByText("Scanning… started 2 minutes ago")).toBeInTheDocument();
    expect(screen.getByText("Detected from 14 sample files · last scan 5 minutes ago")).toBeInTheDocument();
    expect(screen.getByText("Rule c1")).toBeInTheDocument();
  });

  it("counts a running scan without a start time from when it was queued", () => {
    state.data = withLatest(scanned([candidate("c1")]), "running");
    renderView();
    expect(screen.getByText("Scanning… started 1 minute ago")).toBeInTheDocument();
  });

  it("says a re-scan is queued", () => {
    state.data = withLatest(scanned([candidate("c1")]), "queued");
    renderView();
    expect(screen.getByText("Scan queued…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("shows a failed re-scan's reason (or a fallback) and unlocks Re-scan", async () => {
    const user = userEvent.setup();
    state.data = withLatest(scanned([candidate("c1", "accepted")]), "failed", { error: "Model call timed out" });
    renderView();
    expect(screen.getByText("Last scan failed: Model call timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect all" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(hooks.extract).toHaveBeenCalledWith("r1");
    cleanup();

    state.data = withLatest(scanned([candidate("c1")]), "failed", { error: null });
    renderView();
    expect(screen.getByText("Last scan failed for an unknown reason.")).toBeInTheDocument();
  });

  it("shows no status line once a later scan is done", () => {
    state.data = scanned([candidate("c1")]);
    renderView();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last scan failed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeEnabled();
  });

  it("says so when no candidate passed the evidence check", () => {
    state.data = scanned([]);
    renderView();
    expect(screen.getByText(/passed the evidence check/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeInTheDocument();
    expect(screen.queryByText("Deselect all")).not.toBeInTheDocument();
  });

  it("shows the no-repo state for an unknown repo", () => {
    state.repoNotFound = true;
    renderView();
    expect(screen.getByText("No repo selected")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
