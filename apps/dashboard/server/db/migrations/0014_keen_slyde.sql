ALTER TABLE "report_attachments" DROP CONSTRAINT "report_attachments_kind_check";--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_kind_check" CHECK ("report_attachments"."kind" IN ('screenshot', 'annotated-screenshot', 'replay', 'logs', 'user-file'));