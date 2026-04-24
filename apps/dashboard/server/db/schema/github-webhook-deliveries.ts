import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"

export const githubWebhookDeliveries = pgTable(
  "github_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("github_webhook_deliveries_received_at_idx").on(table.receivedAt)],
)
