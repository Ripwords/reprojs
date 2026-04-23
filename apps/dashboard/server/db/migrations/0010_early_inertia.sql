CREATE TABLE "report_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" text,
	"github_login" text,
	"github_user_id" text,
	"github_avatar_url" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "report_assignees_has_identity" CHECK ("report_assignees"."user_id" is not null or "report_assignees"."github_login" is not null)
);
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_assignee_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "reports_project_assignee_idx";--> statement-breakpoint
ALTER TABLE "report_assignees" ADD CONSTRAINT "report_assignees_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assignees" ADD CONSTRAINT "report_assignees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assignees" ADD CONSTRAINT "report_assignees_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_assignees_report_idx" ON "report_assignees" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_assignees_user_idx" ON "report_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_assignees_report_user_unique" ON "report_assignees" USING btree ("report_id","user_id") WHERE "report_assignees"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_assignees_report_github_unique" ON "report_assignees" USING btree ("report_id","github_login") WHERE "report_assignees"."github_login" is not null;--> statement-breakpoint
-- Backfill existing single-assignee rows into report_assignees
INSERT INTO report_assignees (report_id, user_id, assigned_at)
SELECT id, assignee_id, COALESCE(updated_at, created_at)
FROM reports
WHERE assignee_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "assignee_id";