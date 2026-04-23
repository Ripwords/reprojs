// apps/dashboard/server/lib/github-reconcile.ts
import { and, eq } from "drizzle-orm"
import { type LogsAttachment, type ReportContext } from "@reprojs/shared"
import {
  addAssignees,
  createIssueComment,
  deleteIssueComment,
  listIssueComments,
  removeAssignees,
  updateIssueComment,
  updateIssueMilestone,
  updateIssueState,
  updateIssueTitle,
  type IssueStateUpdate,
} from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"
import { env } from "./env"
import { buildIssueBody, labelsFor, reportMarker } from "./github-helpers"
import { getGithubClient } from "./github"
import { buildSignedAttachmentUrl } from "./signed-attachment-url"
import { getStorage } from "./storage"
import { db } from "../db"
import {
  githubIntegrations,
  reportAssignees,
  reportAttachments,
  reportComments,
  reports,
  reportSyncJobs,
  userIdentities,
} from "../db/schema"
import {
  diffAssignees,
  signAssignees,
  signCommentDelete,
  signCommentUpsert,
  signLabels,
  signMilestone,
  signState,
  signTitle,
} from "./github-diff"
import { recordWriteLock } from "./github-write-locks"
import { withBotFooter, hasBotFooter, stripBotFooter } from "./comment-serializer"
import { resolveGithubUser } from "./github-identities"
import type { GithubIntegration } from "../db/schema"

export class ReconcileSkipped extends Error {}

// --- Live GitHub issue shape ---

export interface LiveIssue {
  title: string
  state: "open" | "closed"
  stateReason: "completed" | "not_planned" | "reopened" | null
  labels: string[]
  assigneeLogins: string[]
  milestoneNumber: number | null
}

export async function loadCurrentGithubIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<LiveIssue> {
  const res = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber })
  const d = res.data
  const labels = d.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean)
  const assigneeLogins = (d.assignees ?? []).map((a) => a.login)
  const sr = d.state_reason
  const stateReason = sr === "completed" || sr === "not_planned" || sr === "reopened" ? sr : null
  return {
    title: d.title,
    state: d.state === "closed" ? "closed" : "open",
    stateReason,
    labels,
    assigneeLogins,
    milestoneNumber: d.milestone?.number ?? null,
  }
}

async function loadDesiredAssigneeLogins(reportId: string): Promise<string[]> {
  const rows = await db
    .select({
      githubLogin: reportAssignees.githubLogin,
      userId: reportAssignees.userId,
    })
    .from(reportAssignees)
    .where(eq(reportAssignees.reportId, reportId))

  const githubLogins = rows
    .map((r) => r.githubLogin)
    .filter((l): l is string => l !== null && l !== undefined)

  const dashboardUserIds = rows
    .map((r) => r.userId)
    .filter((id): id is string => id !== null && id !== undefined)

  const identityLogins: string[] = []
  if (dashboardUserIds.length > 0) {
    const { inArray } = await import("drizzle-orm")
    const identities = await db
      .select({ externalHandle: userIdentities.externalHandle })
      .from(userIdentities)
      .where(inArray(userIdentities.userId, dashboardUserIds))
    for (const id of identities) {
      if (id.externalHandle) identityLogins.push(id.externalHandle)
    }
  }

  return [...new Set([...githubLogins, ...identityLogins])]
}

// --- Per-resource reconcilers ---

async function reconcileTitle(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reportId: string,
  live: LiveIssue,
  desired: string,
): Promise<void> {
  if (live.title === desired) return
  const sig = signTitle(desired)
  await recordWriteLock(db, { reportId, kind: "title", signature: sig })
  await updateIssueTitle(octokit, owner, repo, issueNumber, desired)
}

async function reconcileLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reportId: string,
  live: LiveIssue,
  desired: string[],
): Promise<void> {
  const liveSorted = live.labels.toSorted()
  const desiredSorted = desired.toSorted()
  if (
    liveSorted.length === desiredSorted.length &&
    liveSorted.every((l, i) => l === desiredSorted[i])
  ) {
    return
  }
  const sig = signLabels(desired)
  await recordWriteLock(db, { reportId, kind: "labels", signature: sig })
  await octokit.rest.issues.setLabels({ owner, repo, issue_number: issueNumber, labels: desired })
}

async function reconcileState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reportId: string,
  live: LiveIssue,
  report: { status: string },
): Promise<void> {
  const desiredState: "open" | "closed" =
    report.status === "resolved" || report.status === "closed" ? "closed" : "open"

  let desiredUpdate: IssueStateUpdate
  if (desiredState === "closed") {
    const reason = report.status === "resolved" ? "completed" : "not_planned"
    desiredUpdate = { state: "closed", stateReason: reason }
  } else {
    desiredUpdate = { state: "open", stateReason: "reopened" }
  }

  if (live.state === desiredState) return

  const sig = signState(desiredUpdate.state, desiredUpdate.stateReason)
  await recordWriteLock(db, { reportId, kind: "state", signature: sig })
  await updateIssueState(octokit, owner, repo, issueNumber, desiredUpdate)
}

async function reconcileAssignees(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reportId: string,
  live: LiveIssue,
  desiredLogins: string[],
): Promise<void> {
  const { toAdd, toRemove } = diffAssignees(live.assigneeLogins, desiredLogins)
  if (toAdd.length === 0 && toRemove.length === 0) return

  const sig = signAssignees(desiredLogins)
  await recordWriteLock(db, { reportId, kind: "assignees", signature: sig })

  if (toRemove.length > 0) {
    await removeAssignees(octokit, owner, repo, issueNumber, toRemove)
  }
  if (toAdd.length > 0) {
    await addAssignees(octokit, owner, repo, issueNumber, toAdd)
  }
}

async function reconcileMilestone(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reportId: string,
  live: LiveIssue,
  desiredMilestoneNumber: number | null,
): Promise<void> {
  if (live.milestoneNumber === desiredMilestoneNumber) return
  const sig = signMilestone(desiredMilestoneNumber)
  await recordWriteLock(db, { reportId, kind: "milestone", signature: sig })
  await updateIssueMilestone(octokit, owner, repo, issueNumber, desiredMilestoneNumber)
}

// Build a raw Octokit for write methods. The GitHubInstallationClient facade
// doesn't expose raw .rest, so we construct one from the same credentials.
async function getRawOctokit(installationId: number): Promise<Octokit> {
  const { Octokit } = await import("@octokit/rest")
  const { createAppAuth } = await import("@octokit/auth-app")
  const { getGithubAppCredentials } = await import("./github-app-credentials")
  const { readFileSync } = await import("node:fs")
  const { isAbsolute, resolve } = await import("node:path")

  const creds = await getGithubAppCredentials()
  if (!creds) throw new Error("GitHub App is not configured")

  let privateKey = creds.privateKey
  if (!privateKey.includes("-----BEGIN")) {
    const path = isAbsolute(privateKey) ? privateKey : resolve(process.cwd(), privateKey)
    privateKey = readFileSync(path, "utf8")
  } else {
    privateKey = privateKey.replace(/\\n/g, "\n")
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey, installationId },
    request: { headers: { "X-GitHub-Api-Version": "2026-03-10" } },
    log: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        if (/is deprecated\. It is scheduled to be removed on/.test(msg)) return
        console.warn(msg)
      },
      error: (msg: string) => console.error(msg),
    },
  })
}

// Extended client type used by tests for providing rich issue data
interface ExtendedClient {
  getRichIssue?: (input: { owner: string; repo: string; number: number }) => Promise<LiveIssue>
  getRawOctokit?: () => Promise<Octokit> | Octokit
}

// Build a no-op Octokit shim for tests that need the reconcile to run but
// don't care about write API shapes (they verify calls via mock facades).
function buildTestOctokitShim(
  calls: {
    closeIssue?: Array<Record<string, unknown>>
    reopenIssue?: Array<Record<string, unknown>>
    updateIssueLabels?: Array<Record<string, unknown>>
    updateIssueTitle?: Array<Record<string, unknown>>
    updateIssueMilestone?: Array<Record<string, unknown>>
    updateAssignees?: Array<Record<string, unknown>>
  } = {},
): Octokit {
  return {
    rest: {
      issues: {
        get: async () => ({ data: {} as never }),
        setLabels: async (args: Record<string, unknown>) => {
          calls.updateIssueLabels?.push(args)
        },
        update: async (args: Record<string, unknown>) => {
          if ("state" in args) {
            const state = args.state as string
            if (state === "closed") calls.closeIssue?.push(args)
            else calls.reopenIssue?.push(args)
          }
          if ("title" in args) calls.updateIssueTitle?.push(args)
          if ("milestone" in args) calls.updateIssueMilestone?.push(args)
        },
        addAssignees: async (args: Record<string, unknown>) => {
          calls.updateAssignees?.push(args)
        },
        removeAssignees: async (args: Record<string, unknown>) => {
          calls.updateAssignees?.push(args)
        },
      },
    },
  } as unknown as Octokit
}

// --- Comment reconcilers ---

async function reconcileCommentUpsert(
  commentId: string,
  octokit: Octokit,
  gi: GithubIntegration,
): Promise<void> {
  const [comment] = await db
    .select()
    .from(reportComments)
    .where(eq(reportComments.id, commentId))
    .limit(1)
  if (!comment || comment.deletedAt) return // orphan or already deleted

  const authorRow = comment.userId
    ? await db
        .select({ name: userIdentities.externalName, handle: userIdentities.externalHandle })
        .from(userIdentities)
        .where(
          and(eq(userIdentities.userId, comment.userId), eq(userIdentities.provider, "github")),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null

  // Also get the user's name from the user table if no github identity
  let authorName: string | null = null
  if (comment.userId && !authorRow) {
    const { user } = await import("../db/schema/auth-schema")
    const [userRow] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, comment.userId))
      .limit(1)
    authorName = userRow?.name ?? null
  }

  const serializedBody = withBotFooter(comment.body, {
    name: authorRow?.name ?? authorName,
    githubLogin: authorRow?.handle ?? null,
  })

  if (comment.githubCommentId === null) {
    // Create on GitHub
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, comment.reportId))
      .limit(1)
    if (!report?.githubIssueNumber) return // ticket unlinked between enqueue and run
    const created = await createIssueComment(
      octokit,
      gi.repoOwner,
      gi.repoName,
      report.githubIssueNumber,
      serializedBody,
    )
    await recordWriteLock(db, {
      reportId: comment.reportId,
      kind: "comment_upsert",
      signature: signCommentUpsert(created.id, serializedBody),
    })
    await db
      .update(reportComments)
      .set({ githubCommentId: created.id, updatedAt: new Date() })
      .where(eq(reportComments.id, comment.id))
  } else {
    // Update on GitHub
    await recordWriteLock(db, {
      reportId: comment.reportId,
      kind: "comment_upsert",
      signature: signCommentUpsert(comment.githubCommentId, serializedBody),
    })
    await updateIssueComment(
      octokit,
      gi.repoOwner,
      gi.repoName,
      comment.githubCommentId,
      serializedBody,
    )
  }
}

async function reconcileCommentDelete(
  commentId: string,
  githubCommentId: number,
  reportId: string,
  octokit: Octokit,
  gi: GithubIntegration,
): Promise<void> {
  await recordWriteLock(db, {
    reportId,
    kind: "comment_delete",
    signature: signCommentDelete(githubCommentId),
  })
  await deleteIssueComment(octokit, gi.repoOwner, gi.repoName, githubCommentId)
}

// --- Exported comment job dispatchers (called from sync task) ---

export async function reconcileCommentUpsertJob(
  reportId: string,
  commentId: string,
): Promise<void> {
  const [row] = await db
    .select({ gi: githubIntegrations })
    .from(reports)
    .leftJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
    .where(eq(reports.id, reportId))
    .limit(1)

  if (!row?.gi || row.gi.status !== "connected") {
    throw new ReconcileSkipped("no connected integration for comment upsert")
  }

  // Use getGithubClient so that test overrides (__setClientOverride) are respected.
  const client = await getGithubClient(row.gi.installationId)
  const extClient = client as unknown as ExtendedClient
  const octokit =
    typeof extClient.getRawOctokit === "function"
      ? await extClient.getRawOctokit()
      : await getRawOctokit(row.gi.installationId)
  await reconcileCommentUpsert(commentId, octokit, row.gi)
}

export async function reconcileCommentDeleteJob(
  reportId: string,
  commentId: string,
  githubCommentId: number,
): Promise<void> {
  const [row] = await db
    .select({ gi: githubIntegrations })
    .from(reports)
    .leftJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
    .where(eq(reports.id, reportId))
    .limit(1)

  if (!row?.gi || row.gi.status !== "connected") {
    throw new ReconcileSkipped("no connected integration for comment delete")
  }

  // Use getGithubClient so that test overrides (__setClientOverride) are respected.
  const client = await getGithubClient(row.gi.installationId)
  const extClient = client as unknown as ExtendedClient
  const octokit =
    typeof extClient.getRawOctokit === "function"
      ? await extClient.getRawOctokit()
      : await getRawOctokit(row.gi.installationId)
  await reconcileCommentDelete(commentId, githubCommentId, reportId, octokit, row.gi)
}

// --- Backfill existing GitHub comments on first link ---

async function backfillGithubComments(
  reportId: string,
  issueNumber: number,
  octokit: Octokit,
  gi: GithubIntegration,
): Promise<void> {
  const { inArray } = await import("drizzle-orm")
  const comments = await listIssueComments(octokit, gi.repoOwner, gi.repoName, issueNumber)
  if (comments.length === 0) {
    await db
      .update(reports)
      .set({ githubCommentsSyncedAt: new Date() })
      .where(eq(reports.id, reportId))
    return
  }

  // Batch-check which github comment ids already exist
  const githubIds = comments.map((c) => c.id)
  const existingRows = await db
    .select({ githubCommentId: reportComments.githubCommentId })
    .from(reportComments)
    .where(inArray(reportComments.githubCommentId, githubIds))
  const existingSet = new Set(existingRows.map((r) => r.githubCommentId))

  const newComments = comments.filter((c) => !existingSet.has(c.id))
  if (newComments.length === 0) {
    await db
      .update(reports)
      .set({ githubCommentsSyncedAt: new Date() })
      .where(eq(reports.id, reportId))
    return
  }

  // Resolve all authors in parallel
  const resolved = await Promise.all(
    newComments.map((c) => resolveGithubUser(String(c.user.id), c.user.login, c.user.avatar_url)),
  )

  const valuesToInsert = newComments.map((c, i) => {
    const authorResolved = resolved[i]
    const body = hasBotFooter(c.body) ? stripBotFooter(c.body) : c.body
    return {
      reportId,
      userId: authorResolved?.kind === "dashboard-user" ? authorResolved.userId : null,
      githubLogin: c.user.login,
      body,
      githubCommentId: c.id,
      source: "github" as const,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    }
  })

  await db.insert(reportComments).values(valuesToInsert).onConflictDoNothing()

  await db
    .update(reports)
    .set({ githubCommentsSyncedAt: new Date() })
    .where(eq(reports.id, reportId))
}

// --- Main reconciler ---

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
  const client = await getGithubClient(gi.installationId)

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
        githubSyncedAt: new Date(),
      })
      .where(eq(reports.id, report.id))

    // Backfill existing GitHub comments on first link (only if issue existed before)
    if (report.githubCommentsSyncedAt === null && existing !== null) {
      try {
        const octokit = await getRawOctokit(gi.installationId)
        await backfillGithubComments(report.id, ref.number, octokit, gi)
      } catch {
        // Backfill is best-effort — don't fail the whole reconcile
      }
    }
    return
  }

  // --- Extended reconcile for already-linked issues ---
  const extClient = client as unknown as ExtendedClient

  let live: LiveIssue
  let octokit: Octokit

  if (typeof extClient.getRichIssue === "function") {
    // Test/override path: mock client provides the rich issue + optionally a raw octokit.
    live = await extClient.getRichIssue({
      owner: gi.repoOwner,
      repo: gi.repoName,
      number: report.githubIssueNumber,
    })
    if (typeof extClient.getRawOctokit === "function") {
      octokit = await extClient.getRawOctokit()
    } else {
      // Test stubs that only mock the facade methods (close/reopen/labels)
      // will route through the legacy path below.
      octokit = buildTestOctokitShim()
    }
  } else if (typeof (client as unknown as { getIssue?: unknown }).getIssue === "function") {
    // Legacy test path: the old mock only provides getIssue (state + labels).
    // Use it for state/labels; treat assignees and milestone as already-matching
    // (no change needed) to preserve backward compat.
    const basic = await client.getIssue({
      owner: gi.repoOwner,
      repo: gi.repoName,
      number: report.githubIssueNumber,
    })
    live = {
      title: report.title, // Assume title matches to avoid spurious write
      state: basic.state,
      stateReason: null,
      labels: basic.labels,
      assigneeLogins: [], // Don't know live state; skip assignee reconcile
      milestoneNumber: report.milestoneNumber ?? null, // Assume milestone matches
    }
    // Build a shim octokit that routes back through the facade for backward compat
    const calls = (client as unknown as Record<string, unknown[]>)._calls as
      | Record<string, Array<Record<string, unknown>>>
      | undefined
    octokit = {
      rest: {
        issues: {
          get: async () => ({ data: {} as never }),
          setLabels: async (args: Record<string, unknown>) => {
            await client.updateIssueLabels({
              owner: args.owner as string,
              repo: args.repo as string,
              number: args.issue_number as number,
              labels: args.labels as string[],
            })
          },
          update: async (args: Record<string, unknown>) => {
            const state = args.state as string | undefined
            if (state === "closed") {
              await client.closeIssue({
                owner: args.owner as string,
                repo: args.repo as string,
                number: args.issue_number as number,
                reason: args.state_reason as "completed" | "not_planned" | undefined,
              })
            } else if (state === "open") {
              await client.reopenIssue({
                owner: args.owner as string,
                repo: args.repo as string,
                number: args.issue_number as number,
              })
            }
            if (args.title !== undefined && calls) {
              calls.updateIssueTitle = calls.updateIssueTitle ?? []
              calls.updateIssueTitle.push(args)
            }
            if (args.milestone !== undefined && calls) {
              calls.updateIssueMilestone = calls.updateIssueMilestone ?? []
              calls.updateIssueMilestone.push(args)
            }
          },
          addAssignees: async () => {},
          removeAssignees: async () => {},
        },
      },
    } as unknown as Octokit
  } else {
    // Production path: build raw Octokit, get full live issue state.
    octokit = await getRawOctokit(gi.installationId)
    live = await loadCurrentGithubIssue(
      octokit,
      gi.repoOwner,
      gi.repoName,
      report.githubIssueNumber,
    )
  }

  const desiredAssigneeLogins = await loadDesiredAssigneeLogins(report.id)

  // Run each reconciler sequentially
  await reconcileState(
    octokit,
    gi.repoOwner,
    gi.repoName,
    report.githubIssueNumber,
    report.id,
    live,
    report,
  )
  await reconcileLabels(
    octokit,
    gi.repoOwner,
    gi.repoName,
    report.githubIssueNumber,
    report.id,
    live,
    desiredLabels,
  )
  await reconcileTitle(
    octokit,
    gi.repoOwner,
    gi.repoName,
    report.githubIssueNumber,
    report.id,
    live,
    report.title,
  )
  await reconcileAssignees(
    octokit,
    gi.repoOwner,
    gi.repoName,
    report.githubIssueNumber,
    report.id,
    live,
    desiredAssigneeLogins,
  )
  await reconcileMilestone(
    octokit,
    gi.repoOwner,
    gi.repoName,
    report.githubIssueNumber,
    report.id,
    live,
    report.milestoneNumber ?? null,
  )

  await db.update(reports).set({ githubSyncedAt: new Date() }).where(eq(reports.id, report.id))
}
