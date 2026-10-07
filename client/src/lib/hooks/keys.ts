/* hooks/keys.ts — query keys for pull-request and skill data. A key starts with
   the resource and holds every queryFn input, so invalidating a prefix refreshes
   everything under it: `prKeys.all(prId)` covers the PR's detail, reviews,
   runs and comments; `runKeys.all` every run trace; `skillKeys.all` every skill
   list, detail, version history and usage list; `conventionKeys.all(repoId)` a
   repo's conventions and its skill draft. */

export const prKeys = {
  all: (prId: string) => ["pr", prId] as const,
  detail: (prId: string) => ["pr", prId, "detail"] as const,
  reviews: (prId: string) => ["pr", prId, "reviews"] as const,
  runs: (prId: string) => ["pr", prId, "runs"] as const,
  comments: (prId: string) => ["pr", prId, "comments"] as const,
};

export const runKeys = {
  all: ["run"] as const,
  trace: (runId: string) => ["run", runId, "trace"] as const,
};

export const repoKeys = {
  /** Every repo's PR list (the needs-review badge and list statuses). */
  allPulls: ["repo-pulls"] as const,
  pulls: (repoId: string) => ["repo-pulls", repoId] as const,
};

export const skillKeys = {
  all: ["skills"] as const,
  list: ["skills", "list"] as const,
  detail: (skillId: string) => ["skills", skillId] as const,
  versions: (skillId: string) => ["skills", skillId, "versions"] as const,
  agents: (skillId: string) => ["skills", skillId, "agents"] as const,
};

export const conventionKeys = {
  all: (repoId: string) => ["conventions", repoId] as const,
  /** The latest scan + every non-rejected candidate (`ConventionsState`). */
  state: (repoId: string) => ["conventions", repoId, "state"] as const,
  skillDraft: (repoId: string) => ["conventions", repoId, "skill-draft"] as const,
  /** Mutation key of `useUpdateConvention`, so concurrent edits can see each other. */
  update: ["conventions", "update"] as const,
};

/** An agent's ordered skill links — under the agent's own `["agent", id]` prefix. */
export const agentSkillKeys = {
  links: (agentId: string) => ["agent", agentId, "skills"] as const,
};
