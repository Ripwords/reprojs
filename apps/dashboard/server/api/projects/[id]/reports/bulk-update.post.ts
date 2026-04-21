// apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { BulkUpdateInput } from "@reprojs/shared"
import { db } from "../../../../db"
import { projectMembers, reportEvents, reports } from "../../../../db/schema"
import { buildReportEvents } from "../../../../lib/report-events"
import { enqueueSync } from "../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, id, "manager")
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
        statusMessage: "Assignee must be a manager, developer, or owner of this project",
      })
    }
  }

  const toEnqueue: string[] = []

  const { updated } = await db.transaction(async (tx) => {
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

    // Build the shared patch once: bulk-update applies the same field values to every row.
    const sharedPatch: Partial<typeof reports.$inferInsert> = {}
    if (body.status !== undefined) sharedPatch.status = body.status
    if (body.assigneeId !== undefined) sharedPatch.assigneeId = body.assigneeId

    // Filter to rows where at least one field actually changes, and collect per-row audit events.
    const updatedIds: string[] = []
    const allEvents: (typeof reportEvents.$inferInsert)[] = []
    for (const current of currents) {
      const change: Parameters<typeof buildReportEvents>[3] = {}
      if (body.status !== undefined && body.status !== current.status) {
        change.status = { from: current.status, to: body.status }
      }
      if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
        change.assigneeId = { from: current.assigneeId, to: body.assigneeId }
      }
      if (Object.keys(change).length === 0) continue

      updatedIds.push(current.id)
      allEvents.push(...buildReportEvents(current.id, id, actorId, change))
      toEnqueue.push(current.id)
    }

    if (updatedIds.length > 0) {
      // Single batched UPDATE scoped to this project + the ids that actually need patching.
      await tx
        .update(reports)
        .set({ ...sharedPatch, updatedAt: new Date() })
        .where(and(eq(reports.projectId, id), inArray(reports.id, updatedIds)))
    }

    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    return { updated: updatedIds }
  })

  // Fan-out enqueueSync calls in parallel after the transaction commits.
  // enqueueSync uses its own db handle (not the tx), so it must run outside.
  await Promise.all(
    toEnqueue.map((rid) =>
      enqueueSync(rid, id).catch((err) =>
        console.error(`[bulk] enqueueSync failed for ${rid}`, err),
      ),
    ),
  )

  return { updated }
})
