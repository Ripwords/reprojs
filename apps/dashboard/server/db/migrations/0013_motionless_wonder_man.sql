ALTER TABLE "report_assignees" DROP CONSTRAINT "report_assignees_has_identity";--> statement-breakpoint
ALTER TABLE "report_assignees" DROP CONSTRAINT "report_assignees_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "report_assignees_user_idx";--> statement-breakpoint
DROP INDEX "report_assignees_report_user_unique";--> statement-breakpoint
DROP INDEX "report_assignees_report_github_unique";--> statement-breakpoint
ALTER TABLE "report_sync_jobs" DROP CONSTRAINT "report_sync_jobs_pkey";--> statement-breakpoint

-- Data migration (not emitted by drizzle-kit generate — added by hand).
-- Assignees become GitHub-only. For existing dashboard-user assignments we
-- try to resolve their linked github login from user_identities; rows with
-- no resolvable login can never round-trip to GitHub, so delete them. This
-- MUST run before the SET NOT NULL below.
UPDATE "report_assignees" ra
SET "github_login" = ui."external_handle"
FROM "user_identities" ui
WHERE ra."user_id" IS NOT NULL
  AND ra."github_login" IS NULL
  AND ui."user_id" = ra."user_id"
  AND ui."provider" = 'github'
  AND ui."external_handle" IS NOT NULL;--> statement-breakpoint

DELETE FROM "report_assignees" WHERE "github_login" IS NULL;--> statement-breakpoint

ALTER TABLE "report_assignees" ALTER COLUMN "github_login" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_sync_jobs" ADD CONSTRAINT "report_sync_jobs_report_id_signature_pk" PRIMARY KEY("report_id","signature");--> statement-breakpoint
CREATE UNIQUE INDEX "report_assignees_report_github_unique" ON "report_assignees" USING btree ("report_id","github_login");--> statement-breakpoint
ALTER TABLE "report_assignees" DROP COLUMN "user_id";
