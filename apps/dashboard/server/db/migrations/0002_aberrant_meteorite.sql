CREATE TABLE "report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_events_report_created_idx" ON "report_events" USING btree ("report_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "reports_project_status_created_idx" ON "reports" USING btree ("project_id","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX "reports_project_assignee_idx" ON "reports" USING btree ("project_id","assignee_id");--> statement-breakpoint
CREATE INDEX "reports_project_priority_idx" ON "reports" USING btree ("project_id","priority");--> statement-breakpoint
CREATE INDEX "reports_tags_gin_idx" ON "reports" USING gin ("tags");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;
