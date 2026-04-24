import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"
import { githubIntegrations } from "../db/schema/github-integrations"

export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024

export function checkBodySize(length: number | undefined): boolean {
  if (length === undefined) return true
  if (!Number.isFinite(length)) return false
  return length <= MAX_WEBHOOK_BODY_BYTES
}

export type DeliveryStatus = "new" | "replay"

export async function recordDelivery(deliveryId: string): Promise<DeliveryStatus> {
  const [inserted] = await db
    .insert(githubWebhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId })
  return inserted ? "new" : "replay"
}

export async function isKnownInstallation(installationId: number): Promise<boolean> {
  const [row] = await db
    .select({ projectId: githubIntegrations.projectId })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.installationId, installationId))
    .limit(1)
  return !!row
}
