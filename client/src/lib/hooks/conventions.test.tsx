/**
 * Conventions hooks: the endpoints they call, polling only while the newest
 * scan is queued or running, the optimistic accept / reject / edit (a reject
 * removes the card, a refusal rolls back, one refetch after several quick
 * edits), the optimistic Deselect all, starting a scan writing its 202 state
 * into the cache (which starts the polling), a fresh draft per open, and a
 * created skill reaching the Skills Lab list.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionScan, ConventionsState } from "@devdigest/shared";

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("../api", () => ({ api: { get, post, put, del: vi.fn() }, API_BASE: "http://api" }));

import {
  useConventions,
  useConventionSkillDraft,
  useCreateConventionSkill,
  useDeselectAllConventions,
  useExtractConventions,
  useUpdateConvention,
} from "./conventions";
import { conventionKeys, skillKeys } from "./keys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const candidate = (id: string, status: ConventionCandidate["status"] = "pending"): ConventionCandidate => ({
  id,
  category: "naming",
  rule: `rule ${id}`,
  evidence_path: "src/a.ts",
  evidence_start_line: 1,
  evidence_end_line: 2,
  evidence_snippet: "x",
  confidence: 0.9,
  status,
  accepted: status === "accepted",
});

const scanRow = (id: string, status: ConventionScan["status"]): ConventionScan => ({
  id,
  status,
  sample_files: status === "done" ? ["src/a.ts"] : [],
  provider: "openrouter",
  model: "m",
  candidates_found: status === "done" ? 3 : 0,
  candidates_kept: status === "done" ? 3 : 0,
  created_at: "2026-10-04T10:00:00Z",
});

const DONE = scanRow("scan1", "done");
const STATE: ConventionsState = {
  scan: DONE,
  latest_scan: DONE,
  candidates: [candidate("c1"), candidate("c2", "accepted"), candidate("c3", "accepted")],
};
/** STATE while a newer scan is in `status`; the cards still come from the done one. */
const withLatest = (status: ConventionScan["status"]): ConventionsState => ({
  ...STATE,
  latest_scan: scanRow("scan2", status),
});

const cached = (qc: QueryClient) => qc.getQueryData<ConventionsState>(conventionKeys.state("r1"))!;

afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

describe("useConventions", () => {
  it("reads the repo's conventions, and waits for a repo id", async () => {
    const { wrapper } = setup();
    get.mockResolvedValue(STATE);
    const { result, rerender } = renderHook(({ id }) => useConventions(id), {
      wrapper,
      initialProps: { id: null as string | null },
    });
    expect(get).not.toHaveBeenCalled();
    rerender({ id: "r1" });
    await waitFor(() => expect(result.current.data).toEqual(STATE));
    expect(get).toHaveBeenCalledWith("/repos/r1/conventions");
  });

  it("polls every 2 s only while the newest scan is queued or running", async () => {
    const { qc, wrapper } = setup();
    get.mockResolvedValue(withLatest("queued"));
    const { result } = renderHook(() => useConventions("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const interval = () => {
      const query = qc.getQueryCache().find({ queryKey: conventionKeys.state("r1") })!;
      const option = query.observers[0]!.options.refetchInterval;
      return typeof option === "function" ? option(query) : option;
    };
    expect(interval()).toBe(2000);

    const cases: [ConventionsState, number | false][] = [
      [withLatest("running"), 2000],
      [withLatest("done"), false],
      [withLatest("failed"), false],
      [{ scan: null, latest_scan: null, candidates: [] }, false],
    ];
    for (const [state, expected] of cases) {
      qc.setQueryData(conventionKeys.state("r1"), state);
      expect(interval()).toBe(expected);
    }
  });
});

describe("useExtractConventions", () => {
  it("posts the scan and puts its 202 state in the cache", async () => {
    const { qc, wrapper } = setup();
    post.mockResolvedValue(withLatest("queued"));
    const { result } = renderHook(() => useExtractConventions(), { wrapper });
    await act(() => result.current.mutateAsync("r1"));
    expect(post).toHaveBeenCalledWith("/repos/r1/conventions/extract");
    expect(cached(qc)).toEqual(withLatest("queued"));
  });

  it("starts the page polling, which stops once the scan is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { wrapper } = setup();
    const next = { ...STATE, scan: scanRow("scan2", "done"), latest_scan: scanRow("scan2", "done") };
    get.mockResolvedValueOnce(STATE).mockResolvedValueOnce(withLatest("running")).mockResolvedValue(next);
    post.mockResolvedValue(withLatest("queued"));
    const { result } = renderHook(() => ({ state: useConventions("r1"), extract: useExtractConventions() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(get).toHaveBeenCalledTimes(1); // nothing in flight → no polling

    await act(() => result.current.extract.mutateAsync("r1"));
    await waitFor(() => expect(result.current.state.data?.latest_scan?.status).toBe("queued"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.state.data?.latest_scan?.status).toBe("running"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(get).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.state.data).toEqual(next));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe("useUpdateConvention", () => {
  it("accepts at once and rolls back when the server refuses", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(conventionKeys.state("r1"), STATE);
    let reject!: (e: Error) => void;
    put.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { result } = renderHook(() => useUpdateConvention(), { wrapper });

    act(() => result.current.mutate({ repoId: "r1", id: "c1", patch: { status: "accepted" } }));
    await waitFor(() => expect(cached(qc).candidates[0]).toMatchObject({ status: "accepted", accepted: true }));
    expect(put).toHaveBeenCalledWith("/conventions/c1", { status: "accepted" });

    await act(async () => reject(new Error("500")));
    await waitFor(() => expect(cached(qc).candidates[0]).toEqual(STATE.candidates[0]));
  });

  it("removes a rejected card and keeps an edited rule", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(conventionKeys.state("r1"), STATE);
    get.mockReturnValue(new Promise(() => {})); // the refetch afterwards never lands
    put.mockImplementation((path: string, patch: { status?: string; rule?: string }) =>
      Promise.resolve({ ...candidate(path.split("/").pop()!), ...patch }),
    );
    const { result } = renderHook(() => useUpdateConvention(), { wrapper });

    await act(() => result.current.mutateAsync({ repoId: "r1", id: "c2", patch: { status: "rejected" } }));
    expect(cached(qc).candidates.map((c) => c.id)).toEqual(["c1", "c3"]);

    await act(() => result.current.mutateAsync({ repoId: "r1", id: "c1", patch: { rule: "Use kebab-case files" } }));
    expect(cached(qc).candidates[0]!.rule).toBe("Use kebab-case files");
  });

  it("refetches once, after the last of two quick edits", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(conventionKeys.state("r1"), STATE);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const resolvers: ((c: ConventionCandidate) => void)[] = [];
    put.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const { result } = renderHook(() => useUpdateConvention(), { wrapper });

    act(() => result.current.mutate({ repoId: "r1", id: "c1", patch: { status: "accepted" } }));
    act(() => result.current.mutate({ repoId: "r1", id: "c2", patch: { status: "pending" } }));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => resolvers[0]!(candidate("c1", "accepted")));
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => resolvers[1]!(candidate("c2", "pending")));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(cached(qc).candidates.map((c) => c.status)).toEqual(["accepted", "pending", "accepted"]);
  });
});

describe("useDeselectAllConventions", () => {
  it("sets every accepted card back to pending at once", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(conventionKeys.state("r1"), STATE);
    post.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDeselectAllConventions(), { wrapper });
    act(() => result.current.mutate("r1"));
    await waitFor(() => expect(cached(qc).candidates.every((c) => c.status === "pending" && !c.accepted)).toBe(true));
    expect(post).toHaveBeenCalledWith("/repos/r1/conventions/deselect-all");
  });
});

describe("useConventionSkillDraft", () => {
  it("fetches only when enabled and keeps nothing once closed", async () => {
    const { qc, wrapper } = setup();
    const draft = { name: "app-conventions", description: "", type: "convention", body: "b", accepted_count: 2, name_taken: false };
    get.mockResolvedValue(draft);
    const closed = renderHook(() => useConventionSkillDraft("r1", false), { wrapper });
    expect(get).not.toHaveBeenCalled();
    closed.unmount();

    const open = renderHook(() => useConventionSkillDraft("r1"), { wrapper });
    await waitFor(() => expect(open.result.current.data).toEqual(draft));
    expect(get).toHaveBeenCalledWith("/repos/r1/conventions/skill-draft");
    open.unmount();
    await waitFor(() => expect(qc.getQueryData(conventionKeys.skillDraft("r1"))).toBeUndefined());
  });
});

describe("useCreateConventionSkill", () => {
  it("posts the edited draft and refreshes the skill list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(skillKeys.list, []);
    const skill = { id: "s1", name: "app-conventions" };
    post.mockResolvedValue(skill);
    const { result } = renderHook(() => useCreateConventionSkill(), { wrapper });
    const body = { name: "app-conventions", description: "d", type: "convention" as const, body: "b", enabled: true };
    await act(() => result.current.mutateAsync({ repoId: "r1", skill: body }));
    expect(post).toHaveBeenCalledWith("/repos/r1/conventions/skill", body);
    expect(qc.getQueryState(skillKeys.list)?.isInvalidated).toBe(true);
    expect(qc.getQueryData(skillKeys.detail("s1"))).toEqual(skill);
  });
});
