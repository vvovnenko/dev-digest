/**
 * Intent hooks: the endpoints they call, polling only while the latest attempt
 * is queued or running, and starting a derive writing its 202 state into the
 * cache (which starts the polling).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentState } from "@devdigest/shared";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api", () => ({ api: { get, post, put: vi.fn(), del: vi.fn() }, API_BASE: "http://api" }));

import { useDeriveIntent, usePrIntent } from "./intent";
import { prKeys } from "./keys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const state = (status: PrIntentState["status"]): PrIntentState => ({
  pr_id: "p1",
  status,
  error: null,
  stale: false,
  stale_reason: null,
  intent: null,
  provider: null,
  model: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  requested_at: null,
  finished_at: null,
});

afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
  post.mockReset();
});

describe("usePrIntent", () => {
  it("reads the PR's intent, and waits for a PR id", async () => {
    const { wrapper } = setup();
    get.mockResolvedValue(state("none"));
    const { result, rerender } = renderHook(({ id }) => usePrIntent(id), {
      wrapper,
      initialProps: { id: null as string | null },
    });
    expect(get).not.toHaveBeenCalled();
    rerender({ id: "p1" });
    await waitFor(() => expect(result.current.data).toEqual(state("none")));
    expect(get).toHaveBeenCalledWith("/pulls/p1/intent");
  });

  it("polls every 2 s only while the attempt is queued or running", async () => {
    const { qc, wrapper } = setup();
    get.mockResolvedValue(state("queued"));
    const { result } = renderHook(() => usePrIntent("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const interval = () => {
      const query = qc.getQueryCache().find({ queryKey: prKeys.intent("p1") })!;
      const option = query.observers[0]!.options.refetchInterval;
      return typeof option === "function" ? option(query) : option;
    };
    expect(interval()).toBe(2000);

    const cases: [PrIntentState["status"], number | false][] = [
      ["running", 2000],
      ["done", false],
      ["failed", false],
      ["none", false],
    ];
    for (const [status, expected] of cases) {
      qc.setQueryData(prKeys.intent("p1"), state(status));
      expect(interval()).toBe(expected);
    }
  });
});

describe("useDeriveIntent", () => {
  it("posts the derive, puts its 202 state in the cache and starts polling until done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { qc, wrapper } = setup();
    get.mockResolvedValueOnce(state("none")).mockResolvedValueOnce(state("running")).mockResolvedValue(state("done"));
    post.mockResolvedValue(state("queued"));
    const { result } = renderHook(() => ({ intent: usePrIntent("p1"), derive: useDeriveIntent() }), { wrapper });
    await waitFor(() => expect(result.current.intent.isSuccess).toBe(true));

    await act(() => result.current.derive.mutateAsync("p1"));
    expect(post).toHaveBeenCalledWith("/pulls/p1/intent");
    expect(qc.getQueryData(prKeys.intent("p1"))).toEqual(state("queued"));
    await waitFor(() => expect(result.current.intent.data?.status).toBe("queued"));
    expect(get).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.intent.data?.status).toBe("running"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(get).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.intent.data?.status).toBe("done"));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(get).toHaveBeenCalledTimes(3); // done → polling stopped
  });
});
