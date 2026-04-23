import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { reports } from "./reports"
import { user } from "./auth-schema"

export const reportAssignees = pgTable(
  "report_assignees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    githubLogin: text("github_login"),
    githubUserId: text("github_user_id"),
    githubAvatarUrl: text("github_avatar_url"),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("report_assignees_report_idx").on(table.reportId),
    index("report_assignees_user_idx").on(table.userId),
    uniqueIndex("report_assignees_report_user_unique")
      .on(table.reportId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("report_assignees_report_github_unique")
      .on(table.reportId, table.githubLogin)
      .where(sql`${table.githubLogin} is not null`),
    check(
      "report_assignees_has_identity",
      sql`${table.userId} is not null or ${table.githubLogin} is not null`,
    ),
  ],
)

export type ReportAssignee = typeof reportAssignees.$inferSelect
export type NewReportAssignee = typeof reportAssignees.$inferInsert
