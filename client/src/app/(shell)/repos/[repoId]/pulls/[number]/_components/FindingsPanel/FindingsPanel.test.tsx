import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";

const mutate = vi.hoisted(() => vi.fn());
const pending = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
  usePendingFindingIds: () => pending.ids,
}));

import { FindingsPanel } from "./FindingsPanel";
import { visibleFindings } from "./helpers";

afterEach(() => {
  cleanup();
  mutate.mockReset();
  pending.ids = new Set();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

/* Review runs → expanded run: "N CRITICAL · N WARNING" pills under the verdict,
   then Critical / Warning / Suggestion filter buttons
   (server/specs/02-findings-by-severity.md, Amendment). */
describe("FindingsPanel — severity pills and filter", () => {
  const f = (id: string, severity: FindingRecord["severity"], confidence = 0.9): FindingRecord => ({
    ...FINDINGS[0]!,
    id,
    severity,
    title: `Finding ${id}`,
    confidence,
  });
  // Deliberately unsorted: 2 CRITICAL, 1 WARNING, no SUGGESTION.
  const MIXED = [f("w1", "WARNING"), f("c1", "CRITICAL"), f("c2", "CRITICAL", 0.4)];
  const SEVERITY_OF = Object.fromEntries(MIXED.map((x) => [x.id, x.severity]));

  const cardIds = (container: HTMLElement) =>
    [...container.querySelectorAll("[data-finding-id]")].map((el) => el.getAttribute("data-finding-id")!);
  const pills = () => within(screen.getByRole("group", { name: "Findings by severity" }));
  const filterButton = (name: string) =>
    within(screen.getByRole("group", { name: "Filter by severity" })).getByRole("button", { name });

  it("shows a pill only for the severities present", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    expect(pills().getByText("2 CRITICAL")).toBeInTheDocument();
    expect(pills().getByText("1 WARNING")).toBeInTheDocument();
    expect(pills().queryByText(/SUGGESTION/)).not.toBeInTheDocument();
  });

  it("each pill's number equals the cards of that severity listed below", () => {
    const { container } = renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const ids = cardIds(container);
    expect(ids.filter((id) => SEVERITY_OF[id] === "CRITICAL")).toHaveLength(2);
    expect(ids.filter((id) => SEVERITY_OF[id] === "WARNING")).toHaveLength(1);
  });

  it("renders no pill row when the run has no findings", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.queryByRole("group", { name: "Findings by severity" })).not.toBeInTheDocument();
  });

  it("always offers the three filters: Critical, Warning, Suggestion", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const group = within(screen.getByRole("group", { name: "Filter by severity" }));
    expect(group.getAllByRole("button").map((b) => b.textContent)).toEqual(["Critical", "Warning", "Suggestion"]);
  });

  it("a filter keeps only its severity; clicking it again restores the full list", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);

    await user.click(filterButton("Critical"));
    expect(cardIds(container).sort()).toEqual(["c1", "c2"]);

    await user.click(filterButton("Critical"));
    expect(cardIds(container).sort()).toEqual(["c1", "c2", "w1"]);
  });

  it("switching filters replaces the previous one", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    await user.click(filterButton("Critical"));
    await user.click(filterButton("Warning"));
    expect(cardIds(container)).toEqual(["w1"]);
  });

  it("a severity with no findings shows the empty state; the pills stay", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    await user.click(filterButton("Suggestion"));
    expect(screen.getByText("No findings match")).toBeInTheDocument();
    expect(pills().getByText("2 CRITICAL")).toBeInTheDocument();
  });

  it("visibleFindings applies the severity on top of hide-low-confidence", () => {
    expect(visibleFindings(MIXED, false, "CRITICAL").map((x) => x.id)).toEqual(["c1", "c2"]);
    expect(visibleFindings(MIXED, true, "CRITICAL").map((x) => x.id)).toEqual(["c1"]);
    expect(visibleFindings(MIXED, false).map((x) => x.id)).toEqual(["c1", "c2", "w1"]);
  });
});

describe("FindingsPanel shortcuts", () => {
  it("a accepts and d rejects the focused finding", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    await user.keyboard("ad");
    expect(mutate.mock.calls.map(([arg]) => arg)).toEqual([
      { findingId: "f1", action: "accept" },
      { findingId: "f1", action: "dismiss" },
    ]);
  });

  it("stays quiet when another open run holds the shortcuts", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" shortcutsActive={false} />);
    await user.keyboard("ja");
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each(["Meta", "Control", "Alt"])(
    "leaves a/d with %s held to the browser (Cmd+A is select all)",
    async (modifier) => {
      const user = userEvent.setup();
      renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
      await user.keyboard(`{${modifier}>}ad{/${modifier}}`);
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  it("does not act behind an open drawer or dialog", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <>
        <FindingsPanel findings={FINDINGS} prId="pr1" />
        <div role="dialog" aria-modal="true" />
      </>,
    );
    await user.keyboard("a");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("fires an action once when the key is held down", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    await user.keyboard("{a>4/}"); // held: one press, three auto-repeats
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("j and k move the focus, and a acts on the focused finding", async () => {
    const user = userEvent.setup();
    const three = ["f1", "f2", "f3"].map((id) => ({ ...FINDINGS[0]!, id, title: `T ${id}` }));
    renderWithIntl(<FindingsPanel findings={three} prId="pr1" />);
    await user.keyboard("jjjka"); // j past the end stays on the last card
    expect(mutate.mock.calls.map(([arg]) => arg)).toEqual([{ findingId: "f2", action: "accept" }]);
  });
});

describe("FindingsPanel pending actions", () => {
  it("disables only the card whose action is in flight", async () => {
    const user = userEvent.setup();
    pending.ids = new Set(["f1"]);
    const two = [FINDINGS[0]!, { ...FINDINGS[0]!, id: "f2", title: "Second" }];
    const { container } = renderWithIntl(<FindingsPanel findings={two} prId="pr1" />);
    // The first card starts expanded; open the second to show its buttons too.
    await user.click(within(container.querySelector('[data-finding-id="f2"]') as HTMLElement).getByText("Second"));
    const accept = (id: string) =>
      within(container.querySelector(`[data-finding-id="${id}"]`) as HTMLElement).getByRole("button", { name: /Accept/ });
    expect(accept("f1")).toBeDisabled();
    expect(accept("f2")).toBeEnabled();
  });
});
