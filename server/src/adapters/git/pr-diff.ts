import type { GitClient, UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/** A PR's stored file patches (its `pr_files` rows). */
export type StoredPatches = (prId: string) => Promise<{ path: string; patch: string | null }[]>;

/**
 * The diff a review runs on. Prefers a real `git diff base...head` from the
 * clone; falls back to a unified diff assembled from the stored `pr_files`
 * patches, so the reviewer works before a clone completes (and in tests).
 */
export class PrDiffSource {
  constructor(
    /** Lazy: the git adapter is built on first use. */
    private git: () => GitClient,
    private storedPatches: StoredPatches,
  ) {}

  async forPull(
    pull: { id: string; base: string; headSha: string },
    repo: { owner: string; name: string },
  ): Promise<UnifiedDiff> {
    try {
      const diff = await this.git().diff({ owner: repo.owner, name: repo.name }, pull.base, pull.headSha);
      if (diff.files.length > 0) return diff;
    } catch {
      /* fall through to the stored patches */
    }
    return diffFromPatches(await this.storedPatches(pull.id));
  }
}

/** Reconstruct a UnifiedDiff from stored per-file patches. */
export function diffFromPatches(files: { path: string; patch: string | null }[]): UnifiedDiff {
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
