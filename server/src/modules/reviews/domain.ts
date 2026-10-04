import type { CiFailOn, ReviewStrategy } from '@devdigest/shared';

/**
 * Review records — the stored shapes the review service and run executor work
 * with. The Drizzle rows satisfy them structurally, so the repository returns
 * its rows as these types and no mapping layer is needed.
 */

/** The PR a review runs on. */
export interface ReviewPull {
  id: string;
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  body: string | null;
  base: string;
  headSha: string;
}

/** The PR's repo on GitHub. */
export interface ReviewRepoRef {
  id: string;
  owner: string;
  name: string;
}

/** An agent as a review run needs it. */
export interface ReviewAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  repoIntel: boolean;
  version: number;
}

/** A skill the agent's prompt includes (an enabled link to an enabled skill). */
export interface ReviewSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  version: number;
}

export interface ReviewRecord {
  id: string;
  prId: string;
  agentId: string | null;
  runId: string | null;
  kind: string;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
  createdAt: Date;
}

export interface FindingRecord {
  id: string;
  reviewId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  rationale: string;
  suggestion: string | null;
  confidence: number;
  kind: string;
  trifectaComponents: string[] | null;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/** Usage of the run that produced a review; all null when the review has no run. */
export interface RunUsage {
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** One `running` agent_runs row to create. */
export interface NewAgentRun {
  workspaceId: string;
  agentId: string | null;
  prId: string;
  provider: string | null;
  model: string | null;
}

/** The review row a finished run writes (its run id is added by the store). */
export interface NewReview {
  workspaceId: string;
  prId: string;
  agentId: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
}

/** What a run cost and found, written when it ends. */
export interface RunCompletion {
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  /** USD for the run; null = unknown (unpriced model, or a provider that didn't say). */
  costUsd: number | null;
  findingsCount: number;
  grounding: string;
  /** Review score (0-100); null on failed/cancelled runs. */
  score: number | null;
  /** Findings that tripped the agent's gate; null on failed/cancelled runs (no gate result). */
  blockers: number | null;
}

/** How a failed or cancelled run ended, and what its calls cost. */
export interface RunFailure {
  status: 'failed' | 'cancelled';
  error: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}
