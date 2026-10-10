import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: /Accept/ }));
    expect(onAction).toHaveBeenCalledWith("accept");
    // The UI says "Reject"; the API action is still `dismiss`.
    await user.click(screen.getByRole("button", { name: /Reject/ }));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("shows the out-of-scope badge only for a finding marked out_of_scope", () => {
    const { rerender } = renderWithIntl(<FindingCard f={FINDING} />);
    expect(screen.queryByText("out of scope")).not.toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={{ ...FINDING, out_of_scope: false }} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("out of scope")).not.toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={{ ...FINDING, out_of_scope: true }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("out of scope")).toBeInTheDocument();
  });

  it("the chevron button expands and collapses the card from the keyboard", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingCard f={FINDING} />);
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Accept/ })).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Show details" })).toHaveAttribute("aria-expanded", "false");
  });
});
