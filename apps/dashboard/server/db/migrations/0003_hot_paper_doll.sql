ALTER TABLE "reports" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "device_platform" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE INDEX "reports_project_source_created_idx" ON "reports" USING btree ("project_id","source","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "reports_project_idempotency_key_idx"
  ON "reports" ("project_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;