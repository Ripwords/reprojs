import { sql } from "drizzle-orm"
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { reports } from "./reports"

export const githubIntegrations = pgTable(
  "github_integrations",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    repoOwner: text("repo_owner").notNull().default(""),
    repoName: text("repo_name").notNull().default(""),
    defaultLabels: text("default_labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultAssignees: text("default_assignees")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ["connected", "disconnected"] })
      .notNull()
      .default("connected"),
    lastError: text("last_error"),
    connectedBy: text("connected_by"),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    installationIdIdx: index("github_integrations_installation_id_idx").on(table.installationId),
  }),
)

export const reportSyncJobs = pgTable(
  "report_sync_jobs",
  {
    reportId: uuid("report_id")
      .primaryKey()
      .references(() => reports.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["pending", "syncing", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pendingIdx: index("report_sync_jobs_pending_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.state} = 'pending'`),
    failedIdx: index("report_sync_jobs_failed_idx")
      .on(table.state)
      .where(sql`${table.state} = 'failed'`),
  }),
)

export type GithubIntegration = typeof githubIntegrations.$inferSelect
export type NewGithubIntegration = typeof githubIntegrations.$inferInsert
export type ReportSyncJob = typeof reportSyncJobs.$inferSelect
export type NewReportSyncJob = typeof reportSyncJobs.$inferInsert
