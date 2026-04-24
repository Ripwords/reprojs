import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth-schema"

export const identityProviders = pgEnum("identity_provider", ["github"])

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: identityProviders("provider").notNull(),
    externalId: text("external_id").notNull(),
    externalHandle: text("external_handle").notNull(),
    externalName: text("external_name"),
    externalEmail: text("external_email"),
    externalAvatarUrl: text("external_avatar_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_identities_provider_external_id_unique").on(table.provider, table.externalId),
    uniqueIndex("user_identities_user_provider_unique").on(table.userId, table.provider),
  ],
)
