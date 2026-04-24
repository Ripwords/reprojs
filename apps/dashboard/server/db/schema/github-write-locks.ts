import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core"
import { reports } from "./reports"

export const githubWriteLockKinds = pgEnum("github_write_lock_kind", [
  "labels",
  "assignees",
  "milestone",
  "state",
  "title",
  "comment_upsert",
  "comment_delete",
])

export const githubWriteLocks = pgTable(
  "github_write_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: githubWriteLockKinds("kind").notNull(),
    signature: text("signature").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("github_write_locks_lookup_idx").on(table.reportId, table.kind, table.expiresAt),
  ],
)
