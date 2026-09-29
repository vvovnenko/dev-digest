/**
 * ReviewRunAccordion — the header carries the run's cost · in→out tokens
 * (server/specs/01-run-cost-badge.md), next to the verdict and score. The
 * expanded body puts the severity pills under the verdict + PR SCORE
 * (server/specs/02-findings-by-severity.md, Amendment).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  usePendingFindingIds: () => new Set<string>(),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

type Props = React.ComponentProps<typeof ReviewRunAccordion>;
function renderRun(props: Partial<Props> & Pick<Props, "review">) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview: messages }}>
      <ReviewRunAccordion prId="pr-1" open={false} onToggle={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

function review(o: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Two blockers.",
    score: 38,
    model: "deepseek/deepseek-v4-flash",
    created_at: "2026-09-23T20:52:51.000Z",
    findings: [],
    ...o,
  };
}

describe("ReviewRunAccordion — run cost in the header", () => {
  it("shows cost · in→out tokens of the run that produced the review", () => {
    renderRun({ review: review({ cost_usd: 0.0141, tokens_in: 8212, tokens_out: 1301 }) });
    expect(screen.getByText("$0.014 · 8.2K→1.3K")).toBeInTheDocument();
  });

  it("a review without run usage (seeded / pre-migration) reads '—'", () => {
    renderRun({ review: review({ run_id: null }) });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("ReviewRunAccordion — expanded run shows severity pills under the verdict", () => {
  const finding = (id: string, severity: FindingRecord["severity"]): FindingRecord => ({
    id,
    severity,
    category: "security",
    title: `Finding ${id}`,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
  });

  it("verdict + PR SCORE → '2 CRITICAL · 1 SUGGESTION' → finding cards", () => {
    const findings = [finding("c1", "CRITICAL"), finding("s1", "SUGGESTION"), finding("c2", "CRITICAL")];
    renderRun({ review: review({ findings }), open: true });
    const score = screen.getByText("PR SCORE");
    const critical = screen.getByText("2 CRITICAL");
    const suggestion = screen.getByText("1 SUGGESTION");
    const firstCard = screen.getByText("Finding c1");
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(score, critical)).toBe(true);
    expect(follows(critical, suggestion)).toBe(true);
    expect(follows(suggestion, firstCard)).toBe(true);
    expect(screen.queryByText(/WARNING/)).not.toBeInTheDocument();
  });
});

describe("ReviewRunAccordion — header", () => {
  it("is one toggle button (aria-expanded) with the delete button beside it, not inside", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderRun({ review: review({}), onToggle });
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("request changes");
    expect(toggle).toHaveTextContent("0 findings");
    const del = screen.getByRole("button", { name: "Delete this review run" });
    expect(toggle.contains(del)).toBe(false);
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // A real button: Enter and Space toggle too, and Tab reaches delete next.
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(3);
    await user.tab();
    expect(del).toHaveFocus();
  });

  it("scrolls into view once per jump request, then reports it done", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onScrolled = vi.fn();
    const { rerender } = renderRun({ review: review({}), scrollNonce: 1, onScrolled });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onScrolled).toHaveBeenCalledTimes(1);
    rerender(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview: messages }}>
        <ReviewRunAccordion review={review({})} prId="pr-1" open onToggle={vi.fn()} scrollNonce={1} onScrolled={onScrolled} />
      </NextIntlClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

