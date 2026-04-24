import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { reports } from "./reports"
import { user } from "./auth-schema"

// Assignees are a GitHub-mirrored concept only — there is no dashboard-user
// assignment independent of GitHub. The row is effectively a cache of the
// linked issue's assignee list, populated by the reconciler + webhook events.
// `assigned_by` keeps an audit trail of the dashboard user who triggered the
// assignment (nullable for rows planted by a GitHub-side change).
export const reportAssignees = pgTable(
  "report_assignees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    githubLogin: text("github_login").notNull(),
    githubUserId: text("github_user_id"),
    githubAvatarUrl: text("github_avatar_url"),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("report_assignees_report_idx").on(table.reportId),
    uniqueIndex("report_assignees_report_github_unique").on(table.reportId, table.githubLogin),
  ],
)

export type ReportAssignee = typeof reportAssignees.$inferSelect
export type NewReportAssignee = typeof reportAssignees.$inferInsert
