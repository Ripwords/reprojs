// apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { BulkUpdateInput } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { projectMembers, reportEvents, reports } from "../../../../db/schema"
import { buildReportEvents } from "../../../../lib/report-events"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, id, "developer")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => BulkUpdateInput.parse(b))

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
    const currents = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.projectId, id), inArray(reports.id, body.reportIds)))

    if (currents.length !== body.reportIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: "One or more reportIds not found in this project",
      })
    }

    const updated: string[] = []
    const allEvents = []
    for (const current of currents) {
      const patch: Partial<typeof reports.$inferInsert> = {}
      const change: Parameters<typeof buildReportEvents>[2] = {}
      if (body.status !== undefined && body.status !== current.status) {
        patch.status = body.status
        change.status = { from: current.status, to: body.status }
      }
      if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
        patch.assigneeId = body.assigneeId
        change.assigneeId = { from: current.assigneeId, to: body.assigneeId }
      }
      if (Object.keys(patch).length === 0) continue

      patch.updatedAt = new Date()
      await tx.update(reports).set(patch).where(eq(reports.id, current.id))
      updated.push(current.id)
      allEvents.push(...buildReportEvents(current.id, actorId, change))
    }

    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    return { updated }
  })
})
