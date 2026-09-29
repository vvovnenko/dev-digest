/**
 * SeverityCounts — chips + hover popover from server/specs/02-findings-by-severity.md.
 * Guards: zero severities are hidden, all chips are ONE hover target, the popover
 * lists every finding (CRITICAL first, dismissed struck through), and a click in
 * the portalled popover never reaches the parent (the PR list row navigates).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { SeverityCounts, type SeverityCountsProps } from "./SeverityCounts";
import { CLOSE_GRACE_MS, OPEN_DELAY_MS } from "./constants";
import { countBySeverity, plainText, sortBySeverity, totalOf } from "./helpers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f",
    severity: "CRITICAL",
    category: "security",
    title: "A finding",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Why it matters.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "w1", severity: "WARNING", category: "bug", title: "Retry-After header omitted on 429" }),
  finding({ id: "c1", title: "Hardcoded Stripe secret key in commit", rationale: "Starts with `sk_live_`." }),
  finding({
    id: "c2",
    title: "Lethal trifecta: untrusted input reaches exfil path",
    file: "src/api/public/webhooks.ts",
    start_line: 61,
    end_line: 74,
    dismissed_at: "2026-09-23T10:00:00.000Z",
  }),
];
const COUNTS = countBySeverity(FINDINGS); // 2 CRITICAL · 1 WARNING

function renderCounts(props: Partial<SeverityCountsProps>, onParentClick = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <div onClick={onParentClick}>
        <SeverityCounts counts={COUNTS} {...props} />
      </div>
    </NextIntlClientProvider>,
  );
}

const trigger = () => screen.getByLabelText(/findings?:/);

/** Fake timers (the popover's open/close delays) and a user that advances them. */
function setupUser(): UserEvent {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

/** Hover the chips and let the open delay pass. */
async function hoverChips(user: UserEvent) {
  await user.hover(trigger());
  act(() => {
    vi.advanceTimersByTime(OPEN_DELAY_MS);
  });
}

describe("severity helpers", () => {
  it("counts every finding per severity, dismissed included", () => {
    expect(COUNTS).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(totalOf(COUNTS)).toBe(3);
  });

  it("sorts most severe first and keeps order within a severity", () => {
    expect(sortBySeverity(FINDINGS).map((f) => f.id)).toEqual(["c1", "c2", "w1"]);
  });

  it("turns markdown rationale into a plain-text preview", () => {
    expect(plainText("Starts with `sk_live_` — **rotate** [now](https://x.y).\n\nSecond")).toBe(
      "Starts with sk_live_ — rotate now. Second",
    );
  });
});

describe("SeverityCounts — chips", () => {
  it("renders only non-zero severities, most severe first, as one labelled target", () => {
    renderCounts({ counts: { CRITICAL: 2, WARNING: 0, SUGGESTION: 1 } });
    const t = screen.getByLabelText("3 findings: 2 critical, 1 suggestion");
    expect(t.textContent).toBe("21");
    expect(t).toHaveStyle({ cursor: "help" });
  });

  it("renders nothing when every count is 0", () => {
    const { container } = renderCounts({ counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } });
    expect(container.firstElementChild).toBeEmptyDOMElement(); // the test's wrapper div
  });
});

describe("SeverityCounts — hover popover", () => {
  it("opens after the hover delay with every finding, CRITICAL first", async () => {
    const user = setupUser();
    renderCounts({ findings: FINDINGS, repoFullName: "acme/payments-api", headSha: "abc123" });

    await user.hover(trigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY_MS);
    });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("3 findings in this run")).toBeInTheDocument();
    const titles = within(dialog).getAllByText(/Hardcoded|Lethal|Retry-After/).map((el) => el.textContent);
    expect(titles).toEqual([
      "Hardcoded Stripe secret key in commit",
      "Lethal trifecta: untrusted input reaches exfil path",
      "Retry-After header omitted on 429",
    ]);
    expect(within(dialog).getByText("Starts with sk_live_.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "src/api/public/webhooks.ts:61-74" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/webhooks.ts#L61-L74",
    );
  });

  it("strikes through a dismissed finding", async () => {
    const user = setupUser();
    renderCounts({ findings: FINDINGS });
    await hoverChips(user);
    expect(screen.getByText("Lethal trifecta: untrusted input reaches exfil path")).toHaveStyle({
      textDecoration: "line-through",
    });
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toHaveStyle({ textDecoration: "none" });
  });

  it("closes on Escape", async () => {
    const user = setupUser();
    renderCounts({ findings: FINDINGS });
    await hoverChips(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open while the pointer moves onto it, closes after leaving it", async () => {
    const user = setupUser();
    renderCounts({ findings: FINDINGS });
    await hoverChips(user);

    await user.hover(screen.getByRole("dialog")); // leaves the chips, enters the popover
    act(() => {
      vi.advanceTimersByTime(CLOSE_GRACE_MS * 3);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.unhover(screen.getByRole("dialog"));
    act(() => {
      vi.advanceTimersByTime(CLOSE_GRACE_MS);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks the parent for data on hover and shows a skeleton until it arrives", async () => {
    const user = setupUser();
    const onHoverStart = vi.fn();
    renderCounts({ findings: undefined, loading: true, onHoverStart });
    await hoverChips(user);
    expect(onHoverStart).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Loading findings…")).toBeInTheDocument();
  });

  it("shows an error line when loading failed", async () => {
    const user = setupUser();
    renderCounts({ findings: undefined, error: true });
    await hoverChips(user);
    expect(screen.getByText("Couldn’t load findings")).toBeInTheDocument();
  });

  it("a click inside the popover never reaches the parent (the PR list row)", async () => {
    const user = setupUser();
    const onParentClick = vi.fn();
    renderCounts({ findings: FINDINGS }, onParentClick);
    await hoverChips(user);
    await user.click(screen.getByText("Retry-After header omitted on 429"));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
