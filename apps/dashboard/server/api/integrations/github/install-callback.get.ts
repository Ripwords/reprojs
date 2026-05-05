import { createError, defineEventHandler, getQuery, sendRedirect } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubIntegrations } from "../../../db/schema"
import { env } from "../../../lib/env"
import { verifyInstallState } from "../../../lib/github"
import { requireProjectRole } from "../../../lib/permissions"

function errorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode
    return typeof code === "number" ? code : null
  }
  return null
}

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
      .select({ projectId: githubIntegrations.projectId })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.installationId, installationId))
      .limit(1)
    if (!existing) {
      // Collapse "not found" and "wrong project" into the same response so an
      // attacker can't probe installation_id → project membership.
      throw createError({ statusCode: 404, statusMessage: "installation not found" })
    }
    // This is a GET redirect target from GitHub. If the user isn't signed in,
    // bounce them to sign-in (preserving `next`) instead of returning a raw
    // JSON 401. If they're signed in but lack access to this project, 404 —
    // same response shape as the "no such installation" branch above so the
    // endpoint doesn't leak the installation → project mapping.
    try {
      await requireProjectRole(event, existing.projectId, "developer")
    } catch (err) {
      const status = errorStatus(err)
      if (status === 401) {
        return sendRedirect(event, `/auth/sign-in?next=${encodeURIComponent(event.path)}`, 302)
      }
      if (status === 403) {
        throw createError({ statusCode: 404, statusMessage: "installation not found" })
      }
      throw err
    }
    return sendRedirect(
      event,
      `${env.BETTER_AUTH_URL}/projects/${existing.projectId}/integrations?updated=1`,
      302,
    )
  }

  // Initial install: state is required (issued by our install-redirect).
  if (typeof stateRaw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "missing state" })
  }
  const claims = await verifyInstallState(stateRaw)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: "invalid or expired state" })
  }

  const [existing] = await db
    .select({ projectId: githubIntegrations.projectId })
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
      pushOnEdit: true,
      autoCreateOnIntake: true,
    })
  }

  return sendRedirect(
    event,
    `${env.BETTER_AUTH_URL}/projects/${claims.projectId}/integrations?installed=1`,
    302,
  )
})
