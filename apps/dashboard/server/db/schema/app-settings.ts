import { sql } from "drizzle-orm"
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    signupGated: boolean("signup_gated").notNull().default(false),
    allowedEmailDomains: text("allowed_email_domains")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    singleton: check("app_settings_singleton", sql`${table.id} = 1`),
  }),
)

export type AppSettings = typeof appSettings.$inferSelect
