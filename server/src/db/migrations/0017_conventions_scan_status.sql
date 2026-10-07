ALTER TABLE "convention_scans" ALTER COLUMN "sample_files" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "convention_scans_repo_active_uq" ON "convention_scans" USING btree ("repo_id") WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_status_ck" CHECK ("convention_scans"."status" in ('queued', 'running', 'done', 'failed'));