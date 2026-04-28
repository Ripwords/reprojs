ALTER TABLE "report_attachments" ADD COLUMN "scanned_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "scan_status" text;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "scan_engine" text;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "scan_duration_ms" integer;