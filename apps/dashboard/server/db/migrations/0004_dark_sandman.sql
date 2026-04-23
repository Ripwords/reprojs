CREATE TABLE "github_webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_received_at_idx" ON "github_webhook_deliveries" USING btree ("received_at");