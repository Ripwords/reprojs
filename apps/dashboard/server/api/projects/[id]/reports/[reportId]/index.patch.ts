// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq } from "drizzle-orm"
import { TriagePatchInput } from "@repro/shared"
import { db } from "../../../../../db"
import { projectMembers, reportEvents, reports } from "../../../../../db/schema"
import { buildReportEvents } from "../../../../../lib/report-events"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "developer")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  // Guard: assignee must be a developer or owner of this project.
  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, body.assigneeId)))
      .limit(1)
    if (!member || member.role === "viewer") {
      throw createError({
        statusCode: 400,
        statusMessage: "Assignee must be a developer or owner of this project",
      })
    }
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
      .limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: "Report not found" })

    const patch: Partial<typeof reports.$inferInsert> = {}
    const change: Parameters<typeof buildReportEvents>[3] = {}
    if (body.status !== undefined && body.status !== current.status) {
      patch.status = body.status
      change.status = { from: current.status, to: body.status }
    }
    if (body.priority !== undefined && body.priority !== current.priority) {
      patch.priority = body.priority
      change.priority = { from: current.priority, to: body.priority }
    }
    if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
      patch.assigneeId = body.assigneeId
      change.assigneeId = { from: current.assigneeId, to: body.assigneeId }
    }
    if (body.tags !== undefined) {
      // Normalize: dedupe + preserve input order for stored value.
      const seen = new Set<string>()
      const nextTags: string[] = []
      for (const t of body.tags) {
        if (!seen.has(t)) {
          seen.add(t)
          nextTags.push(t)
        }
      }
      if (
        nextTags.length !== current.tags.length ||
        nextTags.some((t, i) => t !== current.tags[i])
      ) {
        patch.tags = nextTags
        change.tags = { from: current.tags, to: nextTags }
      }
    }

    if (Object.keys(patch).length === 0) {
      // No-op — don't bump updated_at or emit events.
      return { ok: true, updated: false }
    }

    patch.updatedAt = new Date()
    await tx
      .update(reports)
      .set(patch)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))

    const events = buildReportEvents(reportId, id, actorId, change)
    if (events.length > 0) await tx.insert(reportEvents).values(events)

    // Enqueue a GitHub sync job whenever fields actually changed and the project
    // has a connected integration. enqueueSync no-ops when the integration isn't
    // connected. Unlinked reports trigger a create; linked reports trigger an
    // update (labels/state).
    if (events.length > 0) {
      await enqueueSync(reportId, id)
    }

    return { ok: true, updated: true }
  })
})
