-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."github_write_lock_kind" AS ENUM('labels', 'assignees', 'milestone', 'state', 'title', 'comment_upsert', 'comment_delete');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."report_comment_source" AS ENUM('dashboard', 'github');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"signup_gated" boolean DEFAULT false NOT NULL,
	"allowed_email_domains" text[] DEFAULT '{""}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "github_app" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"html_url" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_singleton" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"role" text DEFAULT 'member',
	"status" text DEFAULT 'active',
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_by" text NOT NULL,
	"public_key" text,
	"allowed_origins" text[] DEFAULT '{""}' NOT NULL,
	"daily_report_cap" integer DEFAULT 1000 NOT NULL,
	"replay_enabled" boolean DEFAULT true NOT NULL,
	"public_key_regenerated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "project_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"accepted_by" text
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" text,
	"ip" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"device_platform" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"github_issue_number" integer,
	"github_issue_node_id" text,
	"github_issue_url" text,
	"milestone_number" integer,
	"milestone_title" text,
	"github_synced_at" timestamp with time zone,
	"github_comments_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" real NOT NULL,
	"last_refill_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integrations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"repo_owner" text DEFAULT '' NOT NULL,
	"repo_name" text DEFAULT '' NOT NULL,
	"default_labels" text[] DEFAULT '{""}' NOT NULL,
	"default_assignees" text[] DEFAULT '{""}' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_by" text,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"auto_create_on_intake" boolean DEFAULT false NOT NULL,
	"push_on_edit" boolean DEFAULT false NOT NULL,
	"labels_last_synced_at" timestamp with time zone,
	"milestones_last_synced_at" timestamp with time zone,
	"members_last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_sync_jobs" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_attachments_kind_check" CHECK (kind = ANY (ARRAY['screenshot'::text, 'annotated-screenshot'::text, 'replay'::text, 'logs'::text]))
);
--> statement-breakpoint
CREATE TABLE "github_write_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" "github_write_lock_kind" NOT NULL,
	"signature" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" text,
	"github_login" text,
	"body" text NOT NULL,
	"github_comment_id" bigint,
	"source" "report_comment_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "report_comments_github_comment_id_unique" UNIQUE("github_comment_id")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"external_id" text NOT NULL,
	"external_handle" text NOT NULL,
	"external_name" text,
	"external_email" text,
	"external_avatar_url" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sync_jobs" ADD CONSTRAINT "report_sync_jobs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_write_locks" ADD CONSTRAINT "github_write_locks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_public_key_idx" ON "projects" USING btree ("public_key" text_ops);--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "project_invitations_project_email_idx" ON "project_invitations" USING btree ("project_id" text_ops,"email" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "project_invitations_token_idx" ON "project_invitations" USING btree ("token" text_ops);--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier" text_ops);--> statement-breakpoint
CREATE INDEX "reports_github_issue_number_idx" ON "reports" USING btree ("github_issue_number" int4_ops) WHERE (github_issue_number IS NOT NULL);--> statement-breakpoint
CREATE INDEX "reports_project_assignee_idx" ON "reports" USING btree ("project_id" uuid_ops,"assignee_id" text_ops);--> statement-breakpoint
CREATE INDEX "reports_project_created_idx" ON "reports" USING btree ("project_id" uuid_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "reports_project_idempotency_key_idx" ON "reports" USING btree ("project_id" text_ops,"idempotency_key" text_ops) WHERE (idempotency_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "reports_project_priority_idx" ON "reports" USING btree ("project_id" text_ops,"priority" uuid_ops);--> statement-breakpoint
CREATE INDEX "reports_project_source_created_idx" ON "reports" USING btree ("project_id" timestamp_ops,"source" text_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "reports_project_status_created_idx" ON "reports" USING btree ("project_id" timestamp_ops,"status" timestamp_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "reports_project_updated_at_idx" ON "reports" USING btree ("project_id" timestamp_ops,"updated_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "reports_tags_gin_idx" ON "reports" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "report_events_project_created_at_idx" ON "report_events" USING btree ("project_id" timestamp_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "report_events_report_created_idx" ON "report_events" USING btree ("report_id" timestamp_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "github_integrations_installation_id_idx" ON "github_integrations" USING btree ("installation_id" int8_ops);--> statement-breakpoint
CREATE INDEX "report_sync_jobs_failed_idx" ON "report_sync_jobs" USING btree ("state" text_ops) WHERE (state = 'failed'::text);--> statement-breakpoint
CREATE INDEX "report_sync_jobs_pending_idx" ON "report_sync_jobs" USING btree ("next_attempt_at" timestamp_ops) WHERE (state = 'pending'::text);--> statement-breakpoint
CREATE INDEX "report_attachments_report_idx" ON "report_attachments" USING btree ("report_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "github_write_locks_lookup_idx" ON "github_write_locks" USING btree ("report_id" timestamptz_ops,"kind" enum_ops,"expires_at" enum_ops);--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_received_at_idx" ON "github_webhook_deliveries" USING btree ("received_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "report_comments_report_created_idx" ON "report_comments" USING btree ("report_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_external_id_unique" ON "user_identities" USING btree ("provider" text_ops,"external_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_provider_unique" ON "user_identities" USING btree ("user_id" text_ops,"provider" text_ops);--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id" text_ops);
*/