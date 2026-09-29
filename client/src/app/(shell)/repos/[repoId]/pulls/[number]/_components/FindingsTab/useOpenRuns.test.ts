import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReviewRecord } from "@devdigest/shared";
import { useOpenRuns } from "./useOpenRuns";

const rev = (id: string, run_id: string | null = `run-${id}`) => ({ id, run_id }) as ReviewRecord;

describe("useOpenRuns", () => {
  it("opens the newest review on load, and a review that arrives later — which then takes the shortcuts", () => {
    const { result, rerender } = renderHook(({ reviews }) => useOpenRuns(reviews), {
      initialProps: { reviews: [rev("b"), rev("a")] },
    });
    expect(result.current.isOpen("b")).toBe(true);
    expect(result.current.isOpen("a")).toBe(false);
    expect(result.current.activeId).toBe("b");

    rerender({ reviews: [rev("c"), rev("b"), rev("a")] });
    expect(result.current.isOpen("c")).toBe(true);
    expect(result.current.isOpen("b")).toBe(true); // what the user had open stays open
    expect(result.current.activeId).toBe("c"); // but only one run drives the keys

    rerender({ reviews: [rev("c"), rev("b")] }); // re-rendered / filtered: nothing reopens
    expect(result.current.activeId).toBe("c");
  });

  it("opening a run makes it the active one; closing the active one hands over to another open run", () => {
    const { result } = renderHook(() => useOpenRuns([rev("b"), rev("a")]));
    act(() => result.current.toggle("a"));
    expect(result.current.activeId).toBe("a");
    act(() => result.current.toggle("a"));
    expect(result.current.isOpen("a")).toBe(false);
    expect(result.current.activeId).toBe("b");
  });

  it("a Timeline jump opens its run and asks it to scroll once", () => {
    const { result } = renderHook(() => useOpenRuns([rev("b"), rev("a")]));
    act(() => result.current.jumpTo("run-a"));
    expect(result.current.isOpen("a")).toBe(true);
    expect(result.current.activeId).toBe("a");
    expect(result.current.scrollNonceFor(rev("a"))).toBe(1);
    expect(result.current.scrollNonceFor(rev("b"))).toBe(0);
    act(() => result.current.clearJump());
    expect(result.current.scrollNonceFor(rev("a"))).toBe(0);
  });
});
