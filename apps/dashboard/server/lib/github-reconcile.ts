// apps/dashboard/server/lib/github-reconcile.ts
import { and, eq } from "drizzle-orm"
import { type ReportContext } from "@feedback-tool/shared"
import { buildIssueBody, labelsFor } from "./github-helpers"
import { getAttachmentUrlSecret, getDashboardBaseUrl, getGithubClient } from "./github"
import { buildSignedAttachmentUrl } from "./signed-attachment-url"
import { db } from "../db"
import { githubIntegrations, reportAttachments, reports, reportSyncJobs } from "../db/schema"

export class ReconcileSkipped extends Error {}

export async function reconcileReport(reportId: string): Promise<void> {
  const [row] = await db
    .select({
      r: reports,
      gi: githubIntegrations,
    })
    .from(reports)
    .leftJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
    .where(eq(reports.id, reportId))
    .limit(1)

  if (!row?.gi || row.gi.status !== "connected") {
    // Integration missing or disconnected — stale job. Delete and return.
    await db.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    throw new ReconcileSkipped("no connected integration")
  }
  if (!row.gi.repoOwner || !row.gi.repoName) {
    // Admin hasn't picked a repo yet — defer.
    throw new Error("Integration has no repo configured yet")
  }

  const report = row.r
  const gi = row.gi
  const client = getGithubClient(gi.installationId)

  const desiredLabels = labelsFor(
    { priority: report.priority, tags: report.tags },
    { defaultLabels: gi.defaultLabels },
  )

  const [screenshotRow] = await db
    .select({ id: reportAttachments.id })
    .from(reportAttachments)
    .where(and(eq(reportAttachments.reportId, report.id), eq(reportAttachments.kind, "screenshot")))
    .limit(1)

  const screenshotUrl = screenshotRow
    ? buildSignedAttachmentUrl({
        baseUrl: getDashboardBaseUrl(),
        projectId: report.projectId,
        reportId: report.id,
        kind: "screenshot",
        secret: getAttachmentUrlSecret(),
        ttlSeconds: 60 * 60 * 24 * 7, // 7 days
      })
    : null

  const ctx = report.context as ReportContext
  const bodyInput = {
    id: report.id,
    title: report.title,
    description: report.description ?? "",
    pageUrl: ctx.pageUrl ?? "",
    reporterEmail: ctx.reporter?.email ?? null,
    createdAt: report.createdAt,
    screenshotUrl,
    dashboardUrl: `${getDashboardBaseUrl()}/projects/${report.projectId}/reports/${report.id}`,
  }
  const body = buildIssueBody(bodyInput)

  if (report.githubIssueNumber == null) {
    // Create a new issue.
    const ref = await client.createIssue({
      owner: gi.repoOwner,
      repo: gi.repoName,
      title: report.title,
      body,
      labels: desiredLabels,
      assignees: gi.defaultAssignees,
    })
    await db
      .update(reports)
      .set({
        githubIssueNumber: ref.number,
        githubIssueNodeId: ref.nodeId,
        githubIssueUrl: ref.url,
      })
      .where(eq(reports.id, report.id))
    return
  }

  // Reconcile existing issue state + labels.
  const live = await client.getIssue({
    owner: gi.repoOwner,
    repo: gi.repoName,
    number: report.githubIssueNumber,
  })
  const desiredState: "open" | "closed" =
    report.status === "resolved" || report.status === "closed" ? "closed" : "open"

  if (live.state !== desiredState) {
    if (desiredState === "closed") {
      await client.closeIssue({
        owner: gi.repoOwner,
        repo: gi.repoName,
        number: report.githubIssueNumber,
        reason: report.status === "resolved" ? "completed" : "not_planned",
      })
    } else {
      await client.reopenIssue({
        owner: gi.repoOwner,
        repo: gi.repoName,
        number: report.githubIssueNumber,
      })
    }
  }

  const liveSorted = live.labels.toSorted()
  const desiredSorted = desiredLabels
  if (
    liveSorted.length !== desiredSorted.length ||
    liveSorted.some((l, i) => l !== desiredSorted[i])
  ) {
    await client.updateIssueLabels({
      owner: gi.repoOwner,
      repo: gi.repoName,
      number: report.githubIssueNumber,
      labels: desiredLabels,
    })
  }
}
