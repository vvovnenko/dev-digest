-- Data cleanup before the wave-1 constraints (0012). Each statement removes
-- rows that the new unique indexes, foreign keys and NOT NULL would reject.

-- One row per file / commit of a PR (concurrent detail refreshes duplicated them).
DELETE FROM "pr_files" a USING "pr_files" b
  WHERE a."pr_id" = b."pr_id" AND a."path" = b."path" AND a.ctid < b.ctid;--> statement-breakpoint
DELETE FROM "pr_commits" a USING "pr_commits" b
  WHERE a."pr_id" = b."pr_id" AND a."sha" = b."sha" AND a.ctid < b.ctid;--> statement-breakpoint

-- One live run per agent per PR: an older duplicate can only be an orphan.
UPDATE "agent_runs" a
  SET "status" = 'failed', "error" = coalesce(a."error", 'Superseded by a newer run of the same agent')
  FROM "agent_runs" b
  WHERE a."status" = 'running' AND b."status" = 'running'
    AND a."pr_id" = b."pr_id" AND a."agent_id" = b."agent_id" AND a."ran_at" < b."ran_at";--> statement-breakpoint

-- agent_runs.status becomes NOT NULL.
UPDATE "agent_runs" SET "status" = 'failed' WHERE "status" IS NULL;--> statement-breakpoint

-- reviews.agent_id / run_id get foreign keys: drop links to rows that are gone.
-- A review of a deleted run is removed, as deleting the run would have done.
UPDATE "reviews" SET "agent_id" = NULL
  WHERE "agent_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "agents" WHERE "agents"."id" = "reviews"."agent_id");--> statement-breakpoint
DELETE FROM "reviews"
  WHERE "run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "agent_runs" WHERE "agent_runs"."id" = "reviews"."run_id");--> statement-breakpoint

-- settings (workspace, user, key) becomes unique with NULLS NOT DISTINCT: keep the newest row.
DELETE FROM "settings" a USING "settings" b
  WHERE a."workspace_id" = b."workspace_id" AND a."user_id" IS NOT DISTINCT FROM b."user_id"
    AND a."key" = b."key" AND a.ctid < b.ctid;
