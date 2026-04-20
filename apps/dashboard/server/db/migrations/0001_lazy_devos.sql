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
	CONSTRAINT "github_app_singleton" CHECK ("github_app"."id" = 1)
);
