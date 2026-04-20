import { sql } from "drizzle-orm"
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { encryptedText } from "../custom-types"

/**
 * Singleton row holding the self-hosted GitHub App credentials issued via the
 * manifest flow (POST /api/integrations/github/manifest-callback). Secrets are
 * encrypted at rest via `encryptedText`. For deployments that still use the
 * legacy `GITHUB_APP_*` env vars, this table stays empty and the resolver in
 * `server/lib/github-app-credentials.ts` reads from env instead.
 */
export const githubApp = pgTable(
  "github_app",
  {
    id: integer("id").primaryKey().default(1),
    appId: text("app_id").notNull(),
    slug: text("slug").notNull(),
    privateKey: encryptedText("private_key").notNull(),
    webhookSecret: encryptedText("webhook_secret").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: encryptedText("client_secret").notNull(),
    htmlUrl: text("html_url").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    singleton: check("github_app_singleton", sql`${table.id} = 1`),
  }),
)

export type GithubApp = typeof githubApp.$inferSelect
export type NewGithubApp = typeof githubApp.$inferInsert
