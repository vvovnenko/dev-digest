DROP INDEX "settings_ws_user_key_uq";--> statement-breakpoint
DROP INDEX "repos_ws_fullname_uq";--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "repos_ws_fullname_lower_uq" ON "repos" USING btree ("workspace_id",lower("full_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pr_commits_pr_sha_uq" ON "pr_commits" USING btree ("pr_id","sha");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_files_pr_path_uq" ON "pr_files" USING btree ("pr_id","path");--> statement-breakpoint
CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_created_idx" ON "reviews" USING btree ("pr_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_run_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agents_ws_idx" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_ran_idx" ON "agent_runs" USING btree ("pr_id","ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_running_uq" ON "agent_runs" USING btree ("pr_id","agent_id") WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ws_user_key_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","user_id","key");--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pr_status_ck" CHECK ("pull_requests"."status" in ('open', 'merged', 'closed', 'needs_review'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_severity_ck" CHECK ("findings"."severity" in ('CRITICAL', 'WARNING', 'SUGGESTION'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_confidence_ck" CHECK ("findings"."confidence" between 0 and 1);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_ck" CHECK ("agent_runs"."status" in ('running', 'done', 'failed', 'cancelled'));