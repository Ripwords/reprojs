// apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
//
// Bulk triage. Same contract as the single-report PATCH: assignees are
// github logins, and when `assignees` is present every target report must be
// linked to a GitHub issue on a connected integration (otherwise 409).
// Status is always applicable.
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { BulkUpdateInput } from "@reprojs/shared"
import { db } from "../../../../db"
import { githubIntegrations, reportAssignees, reportEvents, reports } from "../../../../db/schema"
import { buildReportEvents } from "../../../../lib/report-events"
import { enqueueSync } from "../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, id, "manager")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => BulkUpdateInput.parse(b))

  const toEnqueue: string[] = []

  const { updated, shouldEnqueue } = await db.transaction(async (tx) => {
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

    // When bulk-assigning, every row must already be linked to a GitHub
    // issue — assignees have nowhere else to land. Reject the whole batch
    // up front instead of silently skipping the unlinked rows.
    let integrationConnected = false
    let pushOnEdit = false
    if (body.assignees !== undefined) {
      const unlinked = currents.filter((r) => r.githubIssueNumber === null)
      if (unlinked.length > 0) {
        throw createError({
          statusCode: 409,
          statusMessage: `${unlinked.length} report(s) are not linked to a GitHub issue — assignees are GitHub-only`,
        })
      }
      const [gi] = await tx
        .select({ pushOnEdit: githubIntegrations.pushOnEdit, status: githubIntegrations.status })
        .from(githubIntegrations)
        .where(eq(githubIntegrations.projectId, id))
        .limit(1)
      if (!gi || gi.status !== "connected") {
        throw createError({ statusCode: 409, statusMessage: "Project is not connected to GitHub" })
      }
      integrationConnected = true
      pushOnEdit = gi.pushOnEdit
    }

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
      const willChangeAssignees = body.assignees !== undefined
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

    if (body.assignees !== undefined) {
      const proposed = body.assignees
      const allCurrent =
        body.reportIds.length > 0
          ? await tx
              .select({
                reportId: reportAssignees.reportId,
                login: reportAssignees.githubLogin,
              })
              .from(reportAssignees)
              .where(inArray(reportAssignees.reportId, body.reportIds))
          : []

      const currentByReport = new Map<string, string[]>()
      for (const a of allCurrent) {
        if (!a.login) continue
        const arr = currentByReport.get(a.reportId) ?? []
        arr.push(a.login)
        currentByReport.set(a.reportId, arr)
      }

      type AssigneeDiff = { reportId: string; toRemove: string[]; toAdd: string[] }
      const diffs: AssigneeDiff[] = body.reportIds.map((reportId) => {
        const currentLogins = currentByReport.get(reportId) ?? []
        return {
          reportId,
          toRemove: currentLogins.filter((l) => !proposed.includes(l)),
          toAdd: proposed.filter((l) => !currentLogins.includes(l)),
        }
      })

      await Promise.all(
        diffs.flatMap(({ reportId, toRemove, toAdd }) => {
          const ops: Promise<unknown>[] = []
          if (toRemove.length > 0) {
            ops.push(
              tx
                .delete(reportAssignees)
                .where(
                  and(
                    eq(reportAssignees.reportId, reportId),
                    inArray(reportAssignees.githubLogin, toRemove),
                  ),
                ),
            )
          }
          if (toAdd.length > 0) {
            ops.push(
              tx
                .insert(reportAssignees)
                .values(
                  toAdd.map((login) => ({ reportId, githubLogin: login, assignedBy: actorId })),
                ),
            )
          }
          return ops
        }),
      )

      for (const { reportId, toRemove, toAdd } of diffs) {
        for (const login of toRemove) {
          allEvents.push({
            reportId,
            projectId: id,
            actorId,
            kind: "assignee_removed",
            payload: { githubLogin: login },
          })
        }
        for (const login of toAdd) {
          allEvents.push({
            reportId,
            projectId: id,
            actorId,
            kind: "assignee_added",
            payload: { githubLogin: login },
          })
        }
        if ((toRemove.length > 0 || toAdd.length > 0) && !toEnqueue.includes(reportId)) {
          toEnqueue.push(reportId)
        }
      }

      // Bump updatedAt for assignee-only changes (rows not already in updatedIds).
      const assigneeOnlyChanged = body.reportIds.filter((rid) => !updatedIds.includes(rid))
      if (assigneeOnlyChanged.length > 0) {
        await tx
          .update(reports)
          .set({ updatedAt: new Date() })
          .where(and(eq(reports.projectId, id), inArray(reports.id, assigneeOnlyChanged)))
      }
    }

    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    return {
      updated: updatedIds,
      shouldEnqueue: integrationConnected && pushOnEdit,
    }
  })

  // Fan-out enqueueSync calls after the transaction commits — enqueueSync
  // uses its own db handle (not the tx), and is a no-op if push-on-edit is
  // off, so the extra server-side check here just avoids N DB round-trips.
  if (shouldEnqueue) {
    await Promise.all(
      toEnqueue.map((rid) =>
        enqueueSync(rid, id).catch((err) =>
          console.error(`[bulk] enqueueSync failed for ${rid}`, err),
        ),
      ),
    )
  }

  return { updated }
})
