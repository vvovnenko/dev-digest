import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.0013, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};
let currentTrace: RunTrace | undefined = TRACE;
let liveRunning = false;
const traceEnabled: boolean[] = [];

vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: (_runId: string, enabled = true) => {
    traceEnabled.push(enabled);
    return { data: enabled ? currentTrace : undefined, isLoading: false };
  },
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (runIds: string[]) => ({ events: [], running: liveRunning && runIds.length > 0 }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
  liveRunning = false;
  traceEnabled.length = 0;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    await user.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("Run Trace drawer — COST tile (server/specs/01-run-cost-badge.md)", () => {
  it("shows the run cost next to duration and tokens", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("a trace stored before the cost field existed reads '—', never '$0.00'", () => {
    const { cost_usd: _omit, ...stats } = TRACE.stats;
    currentTrace = { ...TRACE, stats };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    expect(screen.getByText("COST").nextSibling).toHaveTextContent("—");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("opens a live run on the live log, says it is running, and doesn't ask for the trace yet", () => {
    liveRunning = true;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running onClose={() => {}} />);
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
    expect(screen.getByText(/· running/)).toBeInTheDocument();
    expect(traceEnabled).not.toContain(true);
  });
});

describe("Run Trace drawer — skills in the prompt assembly (server/specs/03-skills.md)", () => {
  const openAssembly = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByText("Prompt assembly"));
  };

  it("shows one block per enabled skill with its version and added tokens", async () => {
    currentTrace = {
      ...TRACE,
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        skills: "### branch-coverage\n\nRULE-A\n\n### edge-cases\n\nRULE-B",
        skill_blocks: [
          { id: "s1", name: "branch-coverage", version: 3, tokens: 41, text: "### branch-coverage\n\nRULE-A" },
          { id: "s2", name: "edge-cases", version: null, tokens: 9, text: "### edge-cases\n\nRULE-B" },
        ],
      },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    await openAssembly();
    expect(screen.getByText("Skills (dynamic) · 2 skills · +50 tokens")).toBeInTheDocument();
    expect(screen.getByText("branch-coverage · v3")).toBeInTheDocument();
    expect(screen.getByText("+41 tokens")).toBeInTheDocument();
    expect(screen.getByText("edge-cases")).toBeInTheDocument();
    expect(screen.getByText("+9 tokens")).toBeInTheDocument();
    // The joined block is not repeated next to the per-skill blocks.
    expect(screen.queryByText("Skills (dynamic)")).not.toBeInTheDocument();
  });

  it("falls back to the single Skills block for a trace written before skill_blocks", async () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    await openAssembly();
    expect(screen.getByText("Skills (dynamic)")).toBeInTheDocument();
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument();
  });

  it("shows no skills block when the run had none", async () => {
    currentTrace = { ...TRACE, prompt_assembly: { ...TRACE.prompt_assembly, skills: null, skill_blocks: null } };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} running={false} onClose={() => {}} />);
    await openAssembly();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText(/Skills \(dynamic\)/)).not.toBeInTheDocument();
  });
});
