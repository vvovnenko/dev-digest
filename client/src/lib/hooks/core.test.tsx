/**
 * usePulls: the GET only reads, and only screens that ask for it poll it (the
 * PR list; the sidebar badge on /repos/*). Importing from GitHub is a POST:
 * useSyncPulls, and useAutoSyncPulls once per repo.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { get, post, put: vi.fn(), del: vi.fn() } }));

import { useAutoSyncPulls, usePulls, usePullDetail, useSyncPulls } from "./core";
import { repoKeys } from "./keys";

afterEach(() => {
  get.mockReset();
  post.mockReset();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("usePulls", () => {
  it("polls every minute only when asked; a plain observer never does", async () => {
    const { qc, wrapper } = setup();
    get.mockResolvedValue([]);
    const { result } = renderHook(() => ({ badge: usePulls("r1"), list: usePulls("r1", { poll: true }) }), { wrapper });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/repos/r1/pulls");

    const intervals = qc
      .getQueryCache()
      .find({ queryKey: repoKeys.pulls("r1") })!
      .observers.map((o) => o.options.refetchInterval);
    expect(intervals.sort()).toEqual([60_000, false]);
  });

  it("fetches nothing without a repo, and no PR detail without a PR id (never GET /pulls/null)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ pulls: usePulls(null), detail: usePullDetail(null) }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.pulls.fetchStatus).toBe("idle");
    expect(result.current.detail.fetchStatus).toBe("idle");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useSyncPulls / useAutoSyncPulls", () => {
  it("POSTs the poll and re-reads that repo's list", async () => {
    const { qc, wrapper } = setup();
    post.mockResolvedValue({ synced: 2 });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSyncPulls(), { wrapper });
    result.current.mutate("r1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith("/repos/r1/poll");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: repoKeys.pulls("r1") });
  });

  const secrets = (github: boolean) => (url: string) =>
    Promise.resolve(url === "/settings/secrets-status" ? { openai: false, anthropic: false, openrouter: false, github } : []);

  it("syncs silently, once per repo, and only while enabled", async () => {
    const { qc, wrapper } = setup();
    get.mockImplementation(secrets(true));
    post.mockRejectedValue(new Error("network down"));
    const { rerender } = renderHook(({ repo, on }) => useAutoSyncPulls(repo, on), {
      wrapper,
      initialProps: { repo: "r1", on: false },
    });
    expect(post).not.toHaveBeenCalled();
    rerender({ repo: "r1", on: true });
    rerender({ repo: "r1", on: true });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender({ repo: "r2", on: true });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // The global toast (providers.tsx) skips mutations marked silent.
    expect(qc.getMutationCache().getAll().every((m) => m.meta?.silent === true)).toBe(true);
  });

  it("never polls without a GitHub token (the poll could only fail)", async () => {
    const { wrapper } = setup();
    get.mockImplementation(secrets(false));
    renderHook(() => useAutoSyncPulls("r1"), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/settings/secrets-status"));
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });
});
