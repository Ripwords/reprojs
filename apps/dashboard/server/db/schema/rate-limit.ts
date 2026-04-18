import { bigint, pgTable, real, text } from "drizzle-orm/pg-core"

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  tokens: real("tokens").notNull(),
  lastRefillMs: bigint("last_refill_ms", { mode: "number" }).notNull(),
})
