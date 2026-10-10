import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord, PrIntentState } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/brief.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const RECORD: PrIntentRecord = {
  pr_id: "p1",
  summary: "Add retry to the payment client",
  in_scope: ["src/payments/client.ts", "retry backoff"],
  out_of_scope: ["checkout UI"],
  confidence: "high",
  sources: [
    { kind: "title", ref: "title", status: "used", reason: null, chars: 30 },
    { kind: "issue", ref: "#12", status: "used", reason: null, chars: 400 },
    { kind: "issue", ref: "#999", status: "unavailable", reason: "not_found", chars: 0 },
  ],
  missing_context: ["#999: not_found"],
  head_sha: "abc",
  derived_at: "2026-10-09T10:00:00Z",
};

const state = (patch: Partial<PrIntentState> = {}): PrIntentState => ({
  pr_id: "p1",
  status: "done",
  error: null,
  stale: false,
  stale_reason: null,
  intent: RECORD,
  provider: null,
  model: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  requested_at: null,
  finished_at: null,
  ...patch,
});

function renderCard(s: PrIntentState | undefined, props: { loading?: boolean; deriving?: boolean } = {}) {
  const onDerive = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <IntentCard state={s} loading={props.loading ?? false} onDerive={onDerive} deriving={props.deriving ?? false} />
    </NextIntlClientProvider>,
  );
  return onDerive;
}

describe("IntentCard", () => {
  it("none: offers Derive intent, which calls onDerive", async () => {
    const user = userEvent.setup();
    const onDerive = renderCard(state({ status: "none", intent: null }));
    await user.click(screen.getByRole("button", { name: "Derive intent" }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("loading: shows no button or intent yet", () => {
    renderCard(undefined, { loading: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("done: summary, both scope columns, confidence, sources and re-derive", async () => {
    const user = userEvent.setup();
    const onDerive = renderCard(state());
    expect(screen.getByText("Add retry to the payment client")).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("src/payments/client.ts")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("checkout UI")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.queryByText(/add a description or link a spec/)).not.toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("#999 — unavailable (not_found)")).toBeInTheDocument();
    expect(screen.getByText("Missing: #999: not_found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Re-derive intent" }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("low confidence: badge and the hint about a sharper intent", () => {
    renderCard(state({ intent: { ...RECORD, confidence: "low", sources: [], missing_context: [], out_of_scope: [] } }));
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(
      screen.getByText("Derived from title and changed files — add a description or link a spec for a sharper intent"),
    ).toBeInTheDocument();
  });

  it("queued / running: Deriving… while the previous intent stays visible, no re-derive", () => {
    renderCard(state({ status: "running" }));
    expect(screen.getByText("Deriving…")).toBeInTheDocument();
    expect(screen.getByText("Add retry to the payment client")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-derive intent" })).not.toBeInTheDocument();
  });

  it("failed: shows the error and lets the user re-derive", async () => {
    const user = userEvent.setup();
    const onDerive = renderCard(state({ status: "failed", error: "boom", intent: null }));
    expect(screen.getByRole("alert")).toHaveTextContent("Deriving the intent failed.");
    await user.click(screen.getByRole("button", { name: "Re-derive intent" }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("stale: banner naming the reason, with re-derive", () => {
    renderCard(state({ stale: true, stale_reason: "head_changed" }));
    expect(screen.getByText("The PR changed after this intent was derived — re-derive it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-derive intent" })).toBeInTheDocument();
  });
});
