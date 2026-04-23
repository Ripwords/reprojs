// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../../../../db"
import { projectMembers, reportAssignees, reportEvents, reports } from "../../../../../db/schema"
import { buildReportEvents } from "../../../../../lib/report-events"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { compareRole, requireProjectRole } from "../../../../../lib/permissions"
import type { ProjectRoleName } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "manager")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  // Guard: all proposed assignees must be manager-or-above on this project.
  if (body.assigneeIds !== undefined && body.assigneeIds.length > 0) {
    if (body.assigneeIds.length > 10) {
      throw createError({ statusCode: 400, statusMessage: "At most 10 assignees" })
    }
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

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: reports.id,
        projectId: reports.projectId,
        status: reports.status,
        priority: reports.priority,
        tags: reports.tags,
        milestoneNumber: reports.milestoneNumber,
        milestoneTitle: reports.milestoneTitle,
      })
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

    // Assignee diff — always run this block even for empty arrays (to support clearing)
    const assigneeEvents: (typeof reportEvents.$inferInsert)[] = []
    if (body.assigneeIds !== undefined) {
      const currentRows = await tx
        .select({ userId: reportAssignees.userId })
        .from(reportAssignees)
        .where(eq(reportAssignees.reportId, reportId))
      const currentIds = currentRows
        .map((r) => r.userId)
        .filter((x): x is string => x !== null && x !== undefined)
      const proposedIds = body.assigneeIds
      const toRemove = currentIds.filter((uid) => !proposedIds.includes(uid))
      const toAdd = proposedIds.filter((uid) => !currentIds.includes(uid))

      if (toRemove.length > 0) {
        await tx
          .delete(reportAssignees)
          .where(
            and(eq(reportAssignees.reportId, reportId), inArray(reportAssignees.userId, toRemove)),
          )
      }
      if (toAdd.length > 0) {
        await tx
          .insert(reportAssignees)
          .values(toAdd.map((uid) => ({ reportId, userId: uid, assignedBy: actorId })))
      }

      for (const uid of toRemove) {
        assigneeEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_removed",
          payload: { userId: uid },
        })
      }
      for (const uid of toAdd) {
        assigneeEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_added",
          payload: { userId: uid },
        })
      }
    }

    // Milestone diff
    if ("milestone" in body && body.milestone !== undefined) {
      const prev = {
        number: current.milestoneNumber,
        title: current.milestoneTitle,
      }
      const next = body.milestone
      const changed =
        (prev.number === null) !== (next === null) ||
        (prev.number !== null &&
          next !== null &&
          (prev.number !== next.number || prev.title !== next.title))
      if (changed) {
        patch.milestoneNumber = next?.number ?? null
        patch.milestoneTitle = next?.title ?? null
        assigneeEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "milestone_changed",
          payload: { from: prev, to: next },
        })
      }
    }

    // GitHub-only assignees diff
    if (body.githubAssigneeLogins !== undefined) {
      const currentGhRows = await tx
        .select({ login: reportAssignees.githubLogin })
        .from(reportAssignees)
        .where(and(eq(reportAssignees.reportId, reportId), isNotNull(reportAssignees.githubLogin)))
      const currentLogins = currentGhRows
        .map((r) => r.login)
        .filter((x): x is string => x !== null && x !== undefined)
      const proposedLogins = body.githubAssigneeLogins
      const toRemove = currentLogins.filter((l) => !proposedLogins.includes(l))
      const toAdd = proposedLogins.filter((l) => !currentLogins.includes(l))

      if (toRemove.length > 0) {
        await tx
          .delete(reportAssignees)
          .where(
            and(
              eq(reportAssignees.reportId, reportId),
              inArray(reportAssignees.githubLogin, toRemove),
            ),
          )
      }
      if (toAdd.length > 0) {
        await tx
          .insert(reportAssignees)
          .values(toAdd.map((login) => ({ reportId, githubLogin: login, assignedBy: actorId })))
      }
      for (const login of toRemove) {
        assigneeEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_removed",
          payload: { githubLogin: login },
        })
      }
      for (const login of toAdd) {
        assigneeEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_added",
          payload: { githubLogin: login },
        })
      }
    }

    const hasReportPatch = Object.keys(patch).length > 0
    const hasEvents = Object.keys(change).length > 0 || assigneeEvents.length > 0

    if (!hasReportPatch && assigneeEvents.length === 0) {
      // No-op — don't bump updated_at or emit events.
      return { ok: true, updated: false }
    }

    if (hasReportPatch) {
      patch.updatedAt = new Date()
      await tx
        .update(reports)
        .set(patch)
        .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    } else if (assigneeEvents.length > 0) {
      // Bump updatedAt even when only assignees changed
      await tx
        .update(reports)
        .set({ updatedAt: new Date() })
        .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    }

    const reportChangeEvents = buildReportEvents(reportId, id, actorId, change)
    const allEvents = [...reportChangeEvents, ...assigneeEvents]
    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    // Enqueue a GitHub sync job whenever fields actually changed and the project
    // has a connected integration. enqueueSync no-ops when the integration isn't
    // connected. Unlinked reports trigger a create; linked reports trigger an
    // update (labels/state).
    if (hasEvents) {
      await enqueueSync(reportId, id)
    }

    return { ok: true, updated: true }
  })
})
