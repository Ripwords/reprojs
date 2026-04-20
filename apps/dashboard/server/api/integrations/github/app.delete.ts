import { createError, defineEventHandler } from "h3"
import { count, eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubApp, githubIntegrations, reportSyncJobs } from "../../../db/schema"
import { invalidateGithubAppCache } from "../../../lib/github-app-credentials"
import { requireInstallAdmin } from "../../../lib/permissions"

/**
 * Admin-only: drop the DB-resident GitHub App singleton + cascade to every
 * project integration and pending sync job that authenticated against it.
 * Leaves `report_events` untouched so triage history survives a reconnect.
 *
 * Scope note: the endpoint only removes the DB row. Env-var-sourced credentials
 * (GITHUB_APP_* in the deployment's environment) always win at resolve time —
 * the settings UI hides the Disconnect button in that case, so a programmatic
 * DELETE hitting a deployment whose creds come from env will either 404 (no
 * row) or drop an orphaned row without affecting runtime behavior.
 *
 * GitHub still hosts the App on the owner's account after this call; operators
 * who want to fully remove it must visit the App's Advanced settings page in
 * GitHub and delete it there. We surface that URL on the settings UI.
 */
export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)

  // Read the row directly rather than via the cached `getGithubAppCredentials`
  // — its module-level cache can legitimately be stale in-between a manifest
  // insert and the next read.
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 1)).limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "No GitHub App configured" })
  }

  // Count first so the response can tell the operator what actually got
  // wiped. The DELETEs themselves are unconditional — every integration and
  // every sync job depends on the App's credentials we're about to drop.
  const [jobCount] = await db.select({ c: count() }).from(reportSyncJobs)
  const [intCount] = await db.select({ c: count() }).from(githubIntegrations)
  const purgedSyncJobs = jobCount?.c ?? 0
  const purgedIntegrations = intCount?.c ?? 0

  await db.delete(reportSyncJobs)
  await db.delete(githubIntegrations)
  await db.delete(githubApp).where(eq(githubApp.id, 1))

  // Flip the resolver cache so subsequent reads (app-status, etc.) see the
  // absent row instead of the now-deleted creds.
  invalidateGithubAppCache()

  return { ok: true as const, purgedIntegrations, purgedSyncJobs }
})
