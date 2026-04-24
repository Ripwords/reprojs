// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
//
// Triage patch endpoint. Assignees + milestone are GitHub-mirrored concepts
// — they are only accepted when the report is linked to a GitHub issue on a
// connected integration. Otherwise the endpoint returns 409 because those
// fields have no home to land in (there is no dashboard-local assignee
// state). Status / priority / tags are always applicable.
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../../../../db"
import {
  githubIntegrations,
  reportAssignees,
  reportEvents,
  reports,
} from "../../../../../db/schema"
import { buildReportEvents } from "../../../../../lib/report-events"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { publishReportStream } from "../../../../../lib/report-events-bus"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "manager")
  const actorId = session.userId

  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: reports.id,
        projectId: reports.projectId,
        status: reports.status,
        priority: reports.priority,
        tags: reports.tags,
        milestoneNumber: reports.milestoneNumber,
        milestoneTitle: reports.milestoneTitle,
        githubIssueNumber: reports.githubIssueNumber,
      })
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
      .limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: "Report not found" })

    // Integration lookup is used for two separate purposes:
    //   1. Reject GitHub-mirrored mutations (assignees / milestone) when the
    //      report isn't linked or the integration isn't connected — 409.
    //   2. Decide whether any PATCH (even a plain priority/tag/status edit)
    //      should enqueue a push-on-edit sync job.
    // We fetch the integration row once and branch afterwards.
    const wantsGithubMirror = body.assignees !== undefined || body.milestone !== undefined
    let integration: { pushOnEdit: boolean; status: string } | null = null
    if (wantsGithubMirror || current.githubIssueNumber !== null) {
      const [gi] = await tx
        .select({ pushOnEdit: githubIntegrations.pushOnEdit, status: githubIntegrations.status })
        .from(githubIntegrations)
        .where(eq(githubIntegrations.projectId, id))
        .limit(1)
      integration = gi ?? null
    }
    if (wantsGithubMirror) {
      if (current.githubIssueNumber === null) {
        throw createError({
          statusCode: 409,
          statusMessage:
            "Report is not linked to a GitHub issue — assignees and milestone are GitHub-only features",
        })
      }
      if (!integration || integration.status !== "connected") {
        throw createError({
          statusCode: 409,
          statusMessage: "Project is not connected to GitHub",
        })
      }
    }

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

    // Assignee diff — github logins only. Empty array = clear all assignees.
    const mirrorEvents: (typeof reportEvents.$inferInsert)[] = []
    if (body.assignees !== undefined) {
      const currentRows = await tx
        .select({ login: reportAssignees.githubLogin })
        .from(reportAssignees)
        .where(eq(reportAssignees.reportId, reportId))
      const currentLogins = currentRows.map((r) => r.login).filter((x): x is string => x !== null)
      const proposed = body.assignees
      const toRemove = currentLogins.filter((l) => !proposed.includes(l))
      const toAdd = proposed.filter((l) => !currentLogins.includes(l))

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
        mirrorEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_removed",
          payload: { githubLogin: login },
        })
      }
      for (const login of toAdd) {
        mirrorEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "assignee_added",
          payload: { githubLogin: login },
        })
      }
    }

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
        mirrorEvents.push({
          reportId,
          projectId: id,
          actorId,
          kind: "milestone_changed",
          payload: { from: prev, to: next },
        })
      }
    }

    const hasReportPatch = Object.keys(patch).length > 0
    const hasEvents = Object.keys(change).length > 0 || mirrorEvents.length > 0

    if (!hasReportPatch && mirrorEvents.length === 0) {
      // No-op — don't bump updated_at or emit events.
      return { ok: true, updated: false }
    }

    if (hasReportPatch) {
      patch.updatedAt = new Date()
      await tx
        .update(reports)
        .set(patch)
        .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    } else if (mirrorEvents.length > 0) {
      // Bump updatedAt even when only assignees/milestone changed
      await tx
        .update(reports)
        .set({ updatedAt: new Date() })
        .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    }

    const reportChangeEvents = buildReportEvents(reportId, id, actorId, change)
    const allEvents = [...reportChangeEvents, ...mirrorEvents]
    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    // Enqueue a GitHub sync job when we have something to push AND the
    // integration is connected with push-on-edit enabled. Deferred until
    // AFTER the transaction commits so a later rollback doesn't leave a
    // phantom sync job (and a spurious triage SSE notification for changes
    // that never landed) behind.
    const shouldEnqueueGithubSync =
      hasEvents &&
      current.githubIssueNumber !== null &&
      integration?.status === "connected" &&
      integration.pushOnEdit === true

    return { ok: true, updated: true, hasEvents, shouldEnqueueGithubSync }
  })

  // Post-commit side effects: only run if the transaction actually committed
  // AND there was something to publish. Thrown errors inside the tx above
  // abort this block via the normal promise-reject path.
  if (result.updated && result.hasEvents) {
    if (result.shouldEnqueueGithubSync) {
      await enqueueSync(reportId, id)
    }
    publishReportStream(reportId, { kind: "triage" })
  }
  return { ok: result.ok, updated: result.updated }
})
