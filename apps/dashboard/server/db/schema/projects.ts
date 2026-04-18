import { sql } from "drizzle-orm"
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    publicKey: text("public_key"),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dailyReportCap: integer("daily_report_cap").notNull().default(1000),
    publicKeyRegeneratedAt: timestamp("public_key_regenerated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    publicKeyUnique: uniqueIndex("projects_public_key_idx").on(table.publicKey),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
