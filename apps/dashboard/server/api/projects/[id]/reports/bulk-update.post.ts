// apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { BulkUpdateInput } from "@reprojs/shared"
import { db } from "../../../../db"
import { projectMembers, reportAssignees, reportEvents, reports } from "../../../../db/schema"
import { buildReportEvents } from "../../../../lib/report-events"
import { enqueueSync } from "../../../../lib/enqueue-sync"
import { compareRole, requireProjectRole } from "../../../../lib/permissions"
import type { ProjectRoleName } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, id, "manager")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => BulkUpdateInput.parse(b))

  // Guard: all proposed assignees must be manager-or-above on this project.
  if (body.assigneeIds !== undefined && body.assigneeIds.length > 0) {
    const memberRows = await db
      .select({ userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, id), inArray(projectMembers.userId, body.assigneeIds)),
      )
    const memberMap = new Map(memberRows.map((m) => [m.userId, m.role]))
    for (const uid of body.assigneeIds) {
      const role = memberMap.get(uid)
      if (!role || !compareRole(role as ProjectRoleName, "manager")) {
        throw createError({
          statusCode: 400,
          statusMessage: `User ${uid} is not a manager, developer, or owner on this project`,
        })
      }
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

    // Build the shared status patch once: bulk-update applies the same value to every row.
    const sharedPatch: Partial<typeof reports.$inferInsert> = {}
    if (body.status !== undefined) sharedPatch.status = body.status

    // Filter to rows where at least one field actually changes, and collect per-row audit events.
    const updatedIds: string[] = []
    const allEvents: (typeof reportEvents.$inferInsert)[] = []
    for (const current of currents) {
      const change: Parameters<typeof buildReportEvents>[3] = {}
      if (body.status !== undefined && body.status !== current.status) {
        change.status = { from: current.status, to: body.status }
      }
      const willChangeAssignees = body.assigneeIds !== undefined
      if (Object.keys(change).length === 0 && !willChangeAssignees) continue

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

    // Apply assignee diff for every report in the batch (regardless of status change)
    if (body.assigneeIds !== undefined) {
      const proposedIds = body.assigneeIds
      // Load current assignees for all reports in batch
      const allCurrentAssignees =
        body.reportIds.length > 0
          ? await tx
              .select({ reportId: reportAssignees.reportId, userId: reportAssignees.userId })
              .from(reportAssignees)
              .where(inArray(reportAssignees.reportId, body.reportIds))
          : []

      const currentByReport = new Map<string, string[]>()
      for (const a of allCurrentAssignees) {
        if (!a.userId) continue
        const arr = currentByReport.get(a.reportId) ?? []
        arr.push(a.userId)
        currentByReport.set(a.reportId, arr)
      }

      for (const reportId of body.reportIds) {
        const currentIds = currentByReport.get(reportId) ?? []
        const toRemove = currentIds.filter((uid) => !proposedIds.includes(uid))
        const toAdd = proposedIds.filter((uid) => !currentIds.includes(uid))

        if (toRemove.length > 0) {
          await tx
            .delete(reportAssignees)
            .where(
              and(
                eq(reportAssignees.reportId, reportId),
                inArray(reportAssignees.userId, toRemove),
              ),
            )
        }
        if (toAdd.length > 0) {
          await tx
            .insert(reportAssignees)
            .values(toAdd.map((uid) => ({ reportId, userId: uid, assignedBy: actorId })))
        }

        // Emit granular events for this report's assignee changes
        for (const uid of toRemove) {
          allEvents.push({
            reportId,
            projectId: id,
            actorId,
            kind: "assignee_removed",
            payload: { userId: uid },
          })
        }
        for (const uid of toAdd) {
          allEvents.push({
            reportId,
            projectId: id,
            actorId,
            kind: "assignee_added",
            payload: { userId: uid },
          })
        }

        // Track for enqueue if assignees actually changed
        if ((toRemove.length > 0 || toAdd.length > 0) && !toEnqueue.includes(reportId)) {
          toEnqueue.push(reportId)
        }
      }

      // Also update updatedAt for reports that had assignee-only changes (not already in updatedIds)
      const assigneeOnlyChanged = body.reportIds.filter((rid) => !updatedIds.includes(rid))
      if (assigneeOnlyChanged.length > 0) {
        await tx
          .update(reports)
          .set({ updatedAt: new Date() })
          .where(and(eq(reports.projectId, id), inArray(reports.id, assigneeOnlyChanged)))
      }
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
