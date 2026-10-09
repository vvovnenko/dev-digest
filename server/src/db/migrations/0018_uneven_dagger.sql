ALTER TABLE "pr_intent" ALTER COLUMN "intent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "out_of_scope" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "missing_context" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_usd" numeric;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "requested_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_status_ck" CHECK ("pr_intent"."status" in ('queued', 'running', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_ck" CHECK ("pr_intent"."confidence" in ('high', 'medium', 'low'));