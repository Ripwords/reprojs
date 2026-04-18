import { createError, defineEventHandler, getQuery, sendRedirect } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubIntegrations } from "../../../db/schema"
import { getDashboardBaseUrl, verifyInstallState } from "../../../lib/github"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const installationIdRaw = q.installation_id
  const stateRaw = q.state
  const setupAction = typeof q.setup_action === "string" ? q.setup_action : null

  if (typeof installationIdRaw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "missing installation_id" })
  }
  const installationId = Number.parseInt(installationIdRaw, 10)
  if (!Number.isFinite(installationId)) {
    throw createError({ statusCode: 400, statusMessage: "invalid installation_id" })
  }

  // "update" comes from GitHub's post-save redirect when a user changes the
  // installation from within GitHub. No state is sent. We need to (a) find the
  // project that owns this installation, AND (b) verify the calling user has
  // permission on that project — otherwise any authenticated user could redirect
  // themselves into another project's settings just by guessing an installation
  // ID (public sequential integers).
  if (setupAction === "update" && typeof stateRaw !== "string") {
    const [existing] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.installationId, installationId))
      .limit(1)
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: "installation not found" })
    }
    await requireProjectRole(event, existing.projectId, "developer")
    return sendRedirect(
      event,
      `${getDashboardBaseUrl()}/projects/${existing.projectId}/settings?tab=github&updated=1`,
      302,
    )
  }

  // Initial install: state is required (issued by our install-redirect).
  if (typeof stateRaw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "missing state" })
  }
  const claims = verifyInstallState(stateRaw)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: "invalid or expired state" })
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
