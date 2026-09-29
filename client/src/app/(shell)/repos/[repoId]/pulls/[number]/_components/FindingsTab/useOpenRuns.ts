"use client";

import React from "react";
import type { ReviewRecord } from "@devdigest/shared";

/**
 * Which review runs are expanded, which one the keyboard shortcuts drive, and
 * the Timeline's "jump to this run" request.
 *
 * - The newest review opens on first load, and so does a review that arrives
 *   later (a run just finished) — and it takes the shortcuts, so a key press
 *   acts on one run only, however many are open.
 * - Open state is keyed by review id here, not by mount, so re-rendering or
 *   re-keying the accordions doesn't reopen runs or re-scroll to an old target:
 *   the jump request is cleared once its accordion has scrolled.
 */
export function useOpenRuns(reviews: ReviewRecord[]) {
  const [openIds, setOpenIds] = React.useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [jump, setJump] = React.useState<{ runId: string; nonce: number } | null>(null);
  const seen = React.useRef(new Set<string>());

  React.useEffect(() => {
    const fresh = reviews.find((r) => !seen.current.has(r.id));
    for (const r of reviews) seen.current.add(r.id);
    if (!fresh) return;
    setOpenIds((prev) => new Set(prev).add(fresh.id));
    setActiveId(fresh.id);
  }, [reviews]);

  const toggle = (id: string) => {
    const opening = !openIds.has(id);
    const next = new Set(openIds);
    if (opening) next.add(id);
    else next.delete(id);
    setOpenIds(next);
    if (opening) setActiveId(id);
    else if (activeId === id) setActiveId(reviews.find((r) => next.has(r.id))?.id ?? null);
  };

  const jumpTo = (runId: string) => {
    const review = reviews.find((r) => r.run_id === runId);
    if (!review) return;
    setOpenIds((prev) => new Set(prev).add(review.id));
    setActiveId(review.id);
    setJump((prev) => ({ runId, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  return {
    activeId,
    isOpen: (id: string) => openIds.has(id),
    toggle,
    jumpTo,
    /** Non-zero while this review's accordion should scroll into view. */
    scrollNonceFor: (review: ReviewRecord) => (jump && review.run_id === jump.runId ? jump.nonce : 0),
    clearJump: () => setJump(null),
  };
}
