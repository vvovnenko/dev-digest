import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/conventions.json";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/hooks/conventions", () => ({ useUpdateConvention: () => ({ mutate: update, isPending: false }) }));

import { CandidateCard } from "./CandidateCard";

afterEach(() => {
  cleanup();
  update.mockReset();
});

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "error_handling",
  rule: "Route handlers throw typed AppErrors instead of replying with a status",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 23,
  evidence_end_line: 31,
  evidence_snippet: "if (!user) throw new NotFoundError('user');",
  confidence: 0.91,
  status: "pending",
  accepted: false,
};

const renderCard = (patch: Partial<ConventionCandidate> = {}, disabled = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CandidateCard candidate={{ ...CANDIDATE, ...patch }} repoId="r1" disabled={disabled} />
    </NextIntlClientProvider>,
  );

const sent = () => update.mock.calls.map((c) => c[0] as unknown);

describe("CandidateCard", () => {
  it("shows the rule, its evidence and the confidence", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("copies the snippet", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderCard();
    await user.click(screen.getByRole("button", { name: "Copy snippet" }));
    expect(writeText).toHaveBeenCalledWith(CANDIDATE.evidence_snippet);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("accepts a pending candidate, and sets an accepted one back to pending", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    cleanup();
    renderCard({ status: "accepted", accepted: true });
    const acceptedBtn = screen.getByRole("button", { name: "Accepted" });
    expect(acceptedBtn).toHaveAttribute("aria-pressed", "true");
    await user.click(acceptedBtn);
    expect(sent()).toEqual([
      { repoId: "r1", id: "c1", patch: { status: "accepted" } },
      { repoId: "r1", id: "c1", patch: { status: "pending" } },
    ]);
  });

  it("rejects", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(sent()).toEqual([{ repoId: "r1", id: "c1", patch: { status: "rejected" } }]);
  });

  it("edits the rule inline and saves it", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByRole("textbox", { name: "Rule" });
    await user.clear(input);
    await user.type(input, "  Handlers throw AppErrors  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(sent()).toEqual([{ repoId: "r1", id: "c1", patch: { rule: "Handlers throw AppErrors" } }]);
    expect(screen.queryByRole("textbox", { name: "Rule" })).not.toBeInTheDocument();
  });

  it("restores the rule on Cancel and on Escape, sending nothing", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Rule" }), " changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Rule" })).toHaveValue(CANDIDATE.rule);
    await user.keyboard(" changed{Escape}");
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("locks its actions while a scan runs", () => {
    renderCard({}, true);
    for (const name of ["Accept", "Reject", "Edit"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});
