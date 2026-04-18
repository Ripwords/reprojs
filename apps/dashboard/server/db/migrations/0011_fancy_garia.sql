-- Denormalize report_events.project_id so event queries no longer need to
-- JOIN through reports just to scope by project. Three-phase dance: add as
-- nullable, backfill from reports.project_id, then enforce NOT NULL + FK.
-- Step 1: add the column as nullable
ALTER TABLE "report_events" ADD COLUMN "project_id" uuid;--> statement-breakpoint

-- Step 2: backfill from the parent report
UPDATE "report_events" e
SET "project_id" = r."project_id"
FROM "reports" r
WHERE e."report_id" = r."id";--> statement-breakpoint

-- Step 3: enforce NOT NULL + FK (cascade mirrors reports.project_id's own FK)
ALTER TABLE "report_events" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Step 4: composite index for the common "project timeline ordered by time desc" read path
CREATE INDEX "report_events_project_created_at_idx" ON "report_events" USING btree ("project_id","created_at" DESC);
