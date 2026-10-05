"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useActiveRepo } from "../../../lib/repo-context";
import { useDeleteRepo } from "../../../lib/hooks";

/**
 * Removing a repo from the switcher asks first: `request(id)` sets `target`, which
 * the shell shows as a confirm modal; `confirm()` deletes it and, when it was the
 * active repo, moves on to the next repo's PRs (or onboarding when none is left).
 */
export function useRemoveRepo() {
  const router = useRouter();
  const { repoId, repos } = useActiveRepo();
  const deleteRepo = useDeleteRepo();
  const [targetId, setTargetId] = React.useState<string | null>(null);

  const request = React.useCallback((id: string) => setTargetId(id), []);
  const cancel = React.useCallback(() => setTargetId(null), []);

  const confirm = () => {
    if (!targetId) return;
    const id = targetId;
    deleteRepo.mutate(id, {
      onSuccess: () => {
        setTargetId(null);
        if (repoId === id) {
          const next = repos.find((r) => r.id !== id);
          router.push(next ? `/repos/${next.id}/pulls` : "/onboarding");
        }
      },
    });
  };

  return {
    /** The repo awaiting confirmation; `name` is undefined if it has left the list. */
    target: targetId ? { id: targetId, name: repos.find((r) => r.id === targetId)?.full_name } : null,
    request,
    cancel,
    confirm,
    pending: deleteRepo.isPending,
  };
}
