ALTER TABLE "app_settings" ADD COLUMN "allowed_email_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "install_name";