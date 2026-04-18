import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { reports } from "./reports"

export const reportEvents = pgTable(
  "report_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    kind: text("kind", {
      enum: [
        "status_changed",
        "assignee_changed",
        "priority_changed",
        "tag_added",
        "tag_removed",
        "github_unlinked",
      ],
    }).notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reportCreatedIdx: index("report_events_report_created_idx").on(
      table.reportId,
      sql`${table.createdAt} DESC`,
    ),
  }),
)

export type ReportEvent = typeof reportEvents.$inferSelect
export type NewReportEvent = typeof reportEvents.$inferInsert
export type ReportEventKind = NonNullable<ReportEvent["kind"]>
