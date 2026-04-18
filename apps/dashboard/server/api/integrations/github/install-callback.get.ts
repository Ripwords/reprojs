import { createError, defineEventHandler, getQuery, sendRedirect } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubIntegrations } from "../../../db/schema"
import { getDashboardBaseUrl, verifyInstallState } from "../../../lib/github"

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const installationIdRaw = q.installation_id
  const stateRaw = q.state
  if (typeof installationIdRaw !== "string" || typeof stateRaw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "missing installation_id or state" })
  }
  const claims = verifyInstallState(stateRaw)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: "invalid or expired state" })
  }
  const installationId = Number.parseInt(installationIdRaw, 10)
  if (!Number.isFinite(installationId)) {
    throw createError({ statusCode: 400, statusMessage: "invalid installation_id" })
  }

  const [existing] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, claims.projectId))
    .limit(1)

  if (existing) {
    await db
      .update(githubIntegrations)
      .set({
        installationId,
        status: "connected",
        lastError: null,
        connectedBy: claims.userId,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(githubIntegrations.projectId, claims.projectId))
  } else {
    await db.insert(githubIntegrations).values({
      projectId: claims.projectId,
      installationId,
      repoOwner: "",
      repoName: "",
      connectedBy: claims.userId,
      status: "connected",
    })
  }

  return sendRedirect(
    event,
    `${getDashboardBaseUrl()}/projects/${claims.projectId}/settings?tab=github&installed=1`,
    302,
  )
})
