import { sql } from "drizzle-orm"
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    signupGated: boolean("signup_gated").notNull().default(false),
    installName: text("install_name").notNull().default("Feedback Tool"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    singleton: check("app_settings_singleton", sql`${table.id} = 1`),
  }),
)

export type AppSettings = typeof appSettings.$inferSelect
