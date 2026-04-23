import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth-schema"
import { projects } from "./projects"

export const reports = pgTable(
  "reports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    context: jsonb("context")
      .notNull()
      .default(sql`'{}'::jsonb`),
    origin: text("origin"),
    ip: text("ip"),
    status: text("status", { enum: ["open", "in_progress", "resolved", "closed"] })
      .notNull()
      .default("open"),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: text("source", { enum: ["web", "expo"] })
      .notNull()
      .default("web"),
    devicePlatform: text("device_platform", { enum: ["ios", "android"] }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueNodeId: text("github_issue_node_id"),
    githubIssueUrl: text("github_issue_url"),
  },
  (table) => ({
    projectCreatedIdx: index("reports_project_created_idx").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
    projectStatusCreatedIdx: index("reports_project_status_created_idx").on(
      table.projectId,
      table.status,
      sql`${table.createdAt} DESC`,
    ),
    projectAssigneeIdx: index("reports_project_assignee_idx").on(table.projectId, table.assigneeId),
    projectPriorityIdx: index("reports_project_priority_idx").on(table.projectId, table.priority),
    tagsGinIdx: index("reports_tags_gin_idx").using("gin", table.tags),
    githubIssueNumberIdx: index("reports_github_issue_number_idx")
      .on(table.githubIssueNumber)
      .where(sql`${table.githubIssueNumber} IS NOT NULL`),
    projectUpdatedAtIdx: index("reports_project_updated_at_idx").on(
      table.projectId,
      sql`${table.updatedAt} DESC`,
    ),
    projectSourceCreatedIdx: index("reports_project_source_created_idx").on(
      table.projectId,
      table.source,
      sql`${table.createdAt} DESC`,
    ),
    projectIdempotencyKeyIdx: index("reports_project_idempotency_key_idx")
      .on(table.projectId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
)

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["screenshot", "annotated-screenshot", "replay", "logs"],
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    kindCheck: check(
      "report_attachments_kind_check",
      sql`${table.kind} IN ('screenshot', 'annotated-screenshot', 'replay', 'logs')`,
    ),
    reportIdx: index("report_attachments_report_idx").on(table.reportId),
  }),
)

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type ReportAttachment = typeof reportAttachments.$inferSelect
export type NewReportAttachment = typeof reportAttachments.$inferInsert
export type AttachmentKind = ReportAttachment["kind"]
