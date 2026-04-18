CREATE INDEX "reports_project_updated_at_idx" ON "reports" USING btree ("project_id","updated_at" DESC);--> statement-breakpoint
CREATE INDEX "github_integrations_installation_id_idx" ON "github_integrations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "report_sync_jobs_failed_idx" ON "report_sync_jobs" USING btree ("state") WHERE "report_sync_jobs"."state" = 'failed';