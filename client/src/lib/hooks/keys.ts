/* hooks/keys.ts — query keys for pull-request data. A key starts with the
   resource and holds every queryFn input, so invalidating a prefix refreshes
   everything under it: `prKeys.all(prId)` covers the PR's detail, reviews,
   runs and comments; `runKeys.all` every run trace. */

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
