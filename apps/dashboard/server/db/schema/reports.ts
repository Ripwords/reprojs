import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectCreatedIdx: index("reports_project_created_idx").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
