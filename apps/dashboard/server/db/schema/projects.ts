import { sql } from "drizzle-orm"
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // Slug is unique only among live projects; soft-deleted slugs can be reused.
    slugActiveUnique: uniqueIndex("projects_slug_active_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
