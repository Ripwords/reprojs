ALTER TABLE "reports" ADD COLUMN "milestone_number" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "milestone_title" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_comments_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD COLUMN "auto_create_on_intake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD COLUMN "push_on_edit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD COLUMN "labels_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD COLUMN "milestones_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD COLUMN "members_last_synced_at" timestamp with time zone;