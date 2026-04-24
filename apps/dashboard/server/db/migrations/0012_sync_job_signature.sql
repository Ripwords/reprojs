-- 0012_sync_job_signature.sql
-- Replace the single-row-per-report PK on report_sync_jobs with a composite
-- (report_id, signature) PK so that a pending comment_upsert job no longer
-- clobbers a pending reconcile job (and vice versa).
--
-- Legacy rows get a signature derived from their payload kind + commentId
-- so in-flight work is preserved across the migration; null-payload rows
-- default to 'reconcile' (matching the historical semantics).
ALTER TABLE "report_sync_jobs" DROP CONSTRAINT "report_sync_jobs_pkey";
ALTER TABLE "report_sync_jobs" ADD COLUMN "signature" text NOT NULL DEFAULT 'reconcile';

UPDATE "report_sync_jobs"
SET "signature" = CASE
  WHEN payload->>'kind' = 'comment_upsert' AND payload->>'commentId' IS NOT NULL
    THEN 'comment_upsert:' || (payload->>'commentId')
  WHEN payload->>'kind' = 'comment_delete' AND payload->>'commentId' IS NOT NULL
    THEN 'comment_delete:' || (payload->>'commentId')
  ELSE 'reconcile'
END
WHERE payload IS NOT NULL;

ALTER TABLE "report_sync_jobs" ADD CONSTRAINT "report_sync_jobs_pkey" PRIMARY KEY ("report_id", "signature");
