// apps/dashboard/server/lib/github-reconcile.ts
import { eq } from "drizzle-orm"
import { type LogsAttachment, type ReportContext } from "@repro/shared"
import { env } from "./env"
import { buildIssueBody, labelsFor, reportMarker } from "./github-helpers"
import { getGithubClient } from "./github"
import { buildSignedAttachmentUrl } from "./signed-attachment-url"
import { getStorage } from "./storage"
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

  const attachmentRows = await db
    .select({
      id: reportAttachments.id,
      kind: reportAttachments.kind,
      storageKey: reportAttachments.storageKey,
    })
    .from(reportAttachments)
    .where(eq(reportAttachments.reportId, report.id))

  const hasScreenshot = attachmentRows.some(
    (a) => a.kind === "screenshot" || a.kind === "annotated-screenshot",
  )
  const logsRow = attachmentRows.find((a) => a.kind === "logs")

  const screenshotUrl = hasScreenshot
    ? buildSignedAttachmentUrl({
        baseUrl: env.BETTER_AUTH_URL,
        projectId: report.projectId,
        reportId: report.id,
        kind: "screenshot",
        secret: env.ATTACHMENT_URL_SECRET,
        ttlSeconds: 60 * 60 * 24 * 7, // 7 days
      })
    : null

  let logs: LogsAttachment | null = null
  if (logsRow) {
    try {
      const storage = await getStorage()
      const { bytes } = await storage.get(logsRow.storageKey)
      logs = JSON.parse(new TextDecoder().decode(bytes)) as LogsAttachment
    } catch {
      logs = null
    }
  }

  const ctx = report.context as ReportContext
  const bodyInput = {
    id: report.id,
    title: report.title,
    description: report.description ?? "",
    pageUrl: ctx.pageUrl ?? "",
    reporterEmail: ctx.reporter?.email ?? null,
    createdAt: report.createdAt,
    screenshotUrl,
    dashboardUrl: `${env.BETTER_AUTH_URL}/projects/${report.projectId}/reports/${report.id}`,
    systemInfo: ctx.systemInfo,
    metadata: ctx.metadata,
    console: logs?.console,
    network: logs?.network,
    breadcrumbs: logs?.breadcrumbs,
    cookies: ctx.cookies,
  }
  const body = buildIssueBody(bodyInput)

  if (report.githubIssueNumber == null) {
    // Idempotency guard: a previous attempt may have created the issue on
    // GitHub but crashed before persisting the linkage back to our DB. Search
    // for an issue containing our marker before creating a fresh one.
    const existing = await client.findIssueByMarker({
      owner: gi.repoOwner,
      repo: gi.repoName,
      marker: reportMarker(report.id),
    })
    const ref =
      existing ??
      (await client.createIssue({
        owner: gi.repoOwner,
        repo: gi.repoName,
        title: report.title,
        body,
        labels: desiredLabels,
        assignees: gi.defaultAssignees,
      }))
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
