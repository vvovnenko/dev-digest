/**
 * Review hooks: the optimistic accept/dismiss (and per-finding pending state),
 * and the run event stream (dedup on reconnect, ends only on `done`).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewRecord } from "@devdigest/shared";

const { post, get, notifyError } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), notifyError: vi.fn() }));
vi.mock("../api", () => ({ api: { post, get, del: vi.fn() }, API_BASE: "http://api" }));
vi.mock("../toast", () => ({ notify: { error: notifyError } }));

import {
  useCancelRun,
  useFindingAction,
  usePendingFindingIds,
  usePrReviews,
  usePrRuns,
  useRunEvents,
  useRunReview,
} from "./reviews";
import { prKeys } from "./keys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const REVIEWS = [
  { id: "r1", findings: [{ id: "f1", accepted_at: null, dismissed_at: "2026-01-01T00:00:00Z" }, { id: "f2" }] },
] as unknown as ReviewRecord[];

afterEach(() => {
  post.mockReset();
  get.mockReset();
  notifyError.mockReset();
});

describe("useFindingAction", () => {
  it("updates the card at once, marks only it pending, and rolls back when the server refuses", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(prKeys.reviews("pr1"), REVIEWS);
    let reject!: (e: Error) => void;
    post.mockReturnValue(new Promise((_, r) => (reject = r)));

    const { result } = renderHook(() => ({ action: useFindingAction("pr1"), pending: usePendingFindingIds("pr1") }), {
      wrapper,
    });
    act(() => result.current.action.mutate({ findingId: "f1", action: "accept" }));

    await waitFor(() => {
      const f1 = qc.getQueryData<ReviewRecord[]>(prKeys.reviews("pr1"))![0]!.findings[0]!;
      expect(f1.accepted_at).not.toBeNull();
      expect(f1.dismissed_at).toBeNull(); // accept and dismiss exclude each other
    });
    expect([...result.current.pending]).toEqual(["f1"]);

    await act(async () => reject(new Error("409")));
    await waitFor(() => expect(result.current.pending.size).toBe(0));
    expect(qc.getQueryData<ReviewRecord[]>(prKeys.reviews("pr1"))![0]!.findings[0]).toEqual(REVIEWS[0]!.findings[0]);
  });
});

/** A controllable EventSource: tests push named events and errors into it. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: object) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.();
  }
}

describe("useRunEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ev = (seq: number, kind = "info") => ({ runId: "run1", seq, kind, msg: `m${seq}`, t: "00:00:01" });

  it("keeps each event once across a reconnect, and ends only on the done event", () => {
    const { result } = renderHook(() => useRunEvents(["run1"]));
    const es = FakeEventSource.instances[0]!;
    act(() => {
      es.emit("info", ev(1));
      es.emit("error", ev(2, "error"));
      es.fail(FakeEventSource.CONNECTING); // dropped: EventSource reconnects by itself
      es.emit("info", ev(1)); // the server replays the run from the start
      es.emit("error", ev(2, "error"));
      es.emit("result", ev(3, "result"));
    });
    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
    expect(es.closed).toBe(false);

    act(() => es.emit("done", { runId: "run1" }));
    expect(result.current.running).toBe(false);
    expect(es.closed).toBe(true);
  });

  it("stops when the server refuses the stream", () => {
    const { result } = renderHook(() => useRunEvents(["run1"]));
    act(() => FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED));
    expect(result.current.running).toBe(false);
  });
});

describe("mutations refresh what they change (invalidation lives in the hook)", () => {
  /** How often `path` was fetched. */
  const fetches = (path: string) => get.mock.calls.filter(([p]) => p === path).length;

  it("starting a review refetches the PR's run history and reviews, so the new run shows at once", async () => {
    const { wrapper } = setup();
    get.mockResolvedValue([]);
    post.mockResolvedValue({ pr_id: "pr1", runs: [{ run_id: "run-9", agent_id: "a1", agent_name: "Sec" }], reviews: [] });
    const { result } = renderHook(
      () => ({ runs: usePrRuns("pr1"), reviews: usePrReviews("pr1"), run: useRunReview() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.runs.isSuccess && result.current.reviews.isSuccess).toBe(true));
    expect(fetches("/pulls/pr1/runs")).toBe(1);

    await act(() => result.current.run.mutateAsync({ prId: "pr1", all: true }));
    await waitFor(() => expect(fetches("/pulls/pr1/runs")).toBe(2));
    expect(fetches("/pulls/pr1/reviews")).toBe(2);
    expect(post).toHaveBeenCalledWith("/pulls/pr1/review", { all: true });
  });

  it("cancelling a run refetches the run history (success or failure)", async () => {
    const { wrapper } = setup();
    get.mockResolvedValue([]);
    const { result } = renderHook(() => ({ runs: usePrRuns("pr1"), cancel: useCancelRun("pr1") }), { wrapper });
    await waitFor(() => expect(result.current.runs.isSuccess).toBe(true));

    post.mockResolvedValueOnce({ ok: true });
    await act(() => result.current.cancel.mutateAsync("run-1"));
    await waitFor(() => expect(fetches("/pulls/pr1/runs")).toBe(2));

    post.mockRejectedValueOnce(new Error("404"));
    await act(async () => {
      await result.current.cancel.mutateAsync("run-2").catch(() => undefined);
    });
    await waitFor(() => expect(fetches("/pulls/pr1/runs")).toBe(3));
  });

  it("the run history polls only while a run is in flight", async () => {
    const { qc, wrapper } = setup();
    get.mockResolvedValue([{ run_id: "run-1", status: "running" }]);
    const { result } = renderHook(() => usePrRuns("pr1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const interval = () => {
      const query = qc.getQueryCache().find({ queryKey: prKeys.runs("pr1") })!;
      const option = query.observers[0]!.options.refetchInterval;
      return typeof option === "function" ? option(query) : option;
    };
    expect(interval()).toBe(4000);

    qc.setQueryData(prKeys.runs("pr1"), [{ run_id: "run-1", status: "done" }]);
    expect(interval()).toBe(false);
  });
});

