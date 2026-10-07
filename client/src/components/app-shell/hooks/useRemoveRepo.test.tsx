import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { push, mutate, active } = vi.hoisted(() => ({
  push: vi.fn(),
  mutate: vi.fn(),
  active: {
    repoId: "r1",
    repos: [
      { id: "r1", full_name: "acme/payments-api" },
      { id: "r2", full_name: "acme/web" },
    ],
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../../lib/repo-context", () => ({ useActiveRepo: () => active }));
vi.mock("../../../lib/hooks", () => ({ useDeleteRepo: () => ({ mutate, isPending: false }) }));

import { useRemoveRepo } from "./useRemoveRepo";

afterEach(() => {
  push.mockReset();
  mutate.mockReset();
});

const succeed = () => mutate.mockImplementation((_id, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());

describe("useRemoveRepo", () => {
  it("a request only asks: it names the repo, and cancel forgets it without deleting", () => {
    const { result } = renderHook(() => useRemoveRepo());
    expect(result.current.target).toBeNull();
    act(() => result.current.request("r2"));
    expect(result.current.target).toEqual({ id: "r2", name: "acme/web" });
    act(() => result.current.cancel());
    expect(result.current.target).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirming the active repo deletes it, closes the modal and opens the next repo's PRs", () => {
    succeed();
    const { result } = renderHook(() => useRemoveRepo());
    act(() => result.current.request("r1"));
    act(() => result.current.confirm());
    expect(mutate).toHaveBeenCalledWith("r1", expect.anything());
    expect(result.current.target).toBeNull();
    expect(push).toHaveBeenCalledWith("/repos/r2/pulls");
  });

  it("removing another repo stays on the page", () => {
    succeed();
    const { result } = renderHook(() => useRemoveRepo());
    act(() => result.current.request("r2"));
    act(() => result.current.confirm());
    expect(mutate).toHaveBeenCalledWith("r2", expect.anything());
    expect(push).not.toHaveBeenCalled();
  });
});
