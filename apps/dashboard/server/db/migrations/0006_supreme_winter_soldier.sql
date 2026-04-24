CREATE TYPE "public"."github_write_lock_kind" AS ENUM('labels', 'assignees', 'milestone', 'state', 'title', 'comment_upsert', 'comment_delete');--> statement-breakpoint
CREATE TABLE "github_write_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" "github_write_lock_kind" NOT NULL,
	"signature" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_write_locks" ADD CONSTRAINT "github_write_locks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_write_locks_lookup_idx" ON "github_write_locks" USING btree ("report_id","kind","expires_at");