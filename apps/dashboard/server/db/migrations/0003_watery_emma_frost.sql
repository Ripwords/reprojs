CREATE TABLE "github_integrations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"repo_owner" text DEFAULT '' NOT NULL,
	"repo_name" text DEFAULT '' NOT NULL,
	"default_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_assignees" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_by" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sync_jobs" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_issue_number" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_issue_node_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_issue_url" text;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sync_jobs" ADD CONSTRAINT "report_sync_jobs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_sync_jobs_pending_idx" ON "report_sync_jobs" USING btree ("next_attempt_at") WHERE "report_sync_jobs"."state" = 'pending';--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "user"("id") ON DELETE SET NULL;
