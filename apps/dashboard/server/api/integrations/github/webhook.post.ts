// apps/dashboard/server/api/integrations/github/webhook.post.ts
import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus } from "h3"
import { and, eq } from "drizzle-orm"
import { verifyWebhookSignature } from "@reprojs/integrations-github"
import { db } from "../../../db"
import { githubIntegrations, reportEvents, reports } from "../../../db/schema"
import { getWebhookSecret } from "../../../lib/github"
import { invalidateInstallationRepos } from "../../../lib/github-repo-cache"
import { parseGithubLabels } from "../../../lib/github-helpers"
import {
  checkBodySize,
  MAX_WEBHOOK_BODY_BYTES,
  recordDelivery,
  isKnownInstallation,
} from "../../../lib/github-webhook-auth"

interface IssuesPayload {
  action: "opened" | "closed" | "reopened" | "edited" | "labeled" | "unlabeled" | "deleted" | string
  issue: {
    number: number
    state: "open" | "closed"
    state_reason?: "completed" | "not_planned" | null
    labels: Array<{ name: string }>
  }
  repository: { name: string; owner: { login: string } }
}

interface InstallationPayload {
  action: "created" | "deleted" | "suspend" | "unsuspend" | string
  installation: { id: number }
}

interface InstallationReposPayload {
  action: "added" | "removed"
  installation: { id: number }
  repositories_removed?: Array<{ name: string; full_name: string }>
}

export default defineEventHandler(async (event) => {
  const contentLength = Number(getHeader(event, "content-length") ?? NaN)
  if (!checkBodySize(Number.isNaN(contentLength) ? undefined : contentLength)) {
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" })
  }
  const raw = await readRawBody(event)
  if (!raw || typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  // Fallback guard when Content-Length is missing or understated (chunked).
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" })
  }
  const sig = getHeader(event, "x-hub-signature-256")
  if (
    !sig ||
    !verifyWebhookSignature({
      secret: await getWebhookSecret(),
      payload: raw,
      signatureHeader: sig,
    })
  ) {
    throw createError({ statusCode: 401, statusMessage: "invalid signature" })
  }

  const deliveryId = getHeader(event, "x-github-delivery")
  if (!deliveryId) {
    throw createError({ statusCode: 400, statusMessage: "Missing X-GitHub-Delivery" })
  }
  if ((await recordDelivery(deliveryId)) === "replay") {
    setResponseStatus(event, 202)
    return { status: "replay" }
  }

  const kind = getHeader(event, "x-github-event")
  const payload: unknown = JSON.parse(raw)

  const installationId = (payload as { installation?: { id?: unknown } })?.installation?.id
  if (typeof installationId === "number" && !(await isKnownInstallation(installationId))) {
    console.warn(
      `[github-webhook] unknown installation id: ${installationId}, delivery=${deliveryId}`,
    )
    setResponseStatus(event, 202)
    return { status: "unknown-installation" }
  }

  if (kind === "installation") {
    const p = payload as InstallationPayload
    if (p.action === "deleted" || p.action === "suspend") {
      await db
        .update(githubIntegrations)
        .set({ status: "disconnected", updatedAt: new Date() })
        .where(eq(githubIntegrations.installationId, p.installation.id))
      invalidateInstallationRepos(p.installation.id)
    }
  } else if (kind === "installation_repositories") {
    const p = payload as InstallationReposPayload
    invalidateInstallationRepos(p.installation.id)
    if (p.action === "removed" && p.repositories_removed?.length) {
      const removedNames = new Set(p.repositories_removed.map((r) => r.full_name))
      const rows = await db
        .select()
        .from(githubIntegrations)
        .where(eq(githubIntegrations.installationId, p.installation.id))
      await Promise.all(
        rows
          .filter((row) => removedNames.has(`${row.repoOwner}/${row.repoName}`))
          .map((row) =>
            db
              .update(githubIntegrations)
              .set({ status: "disconnected", updatedAt: new Date() })
              .where(eq(githubIntegrations.projectId, row.projectId)),
          ),
      )
    }
  } else if (kind === "issues") {
    const p = payload as IssuesPayload
    if (p.action === "closed" || p.action === "reopened") {
      const desired =
        p.action === "reopened"
          ? "open"
          : p.issue.state_reason === "not_planned"
            ? "closed"
            : "resolved"
      const [linked] = await db
        .select({ r: reports, gi: githubIntegrations })
        .from(reports)
        .innerJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
        .where(
          and(
            eq(reports.githubIssueNumber, p.issue.number),
            eq(githubIntegrations.repoOwner, p.repository.owner.login),
            eq(githubIntegrations.repoName, p.repository.name),
          ),
        )
        .limit(1)
      if (linked && linked.r.status !== desired) {
        await db.transaction(async (tx) => {
          await tx
            .update(reports)
            .set({ status: desired, updatedAt: new Date() })
            .where(eq(reports.id, linked.r.id))
          await tx.insert(reportEvents).values({
            reportId: linked.r.id,
            projectId: linked.r.projectId,
            actorId: null,
            kind: "status_changed",
            payload: { from: linked.r.status, to: desired, source: "github" },
          })
        })
      }
    } else if (p.action === "labeled" || p.action === "unlabeled") {
      const issueLabels = p.issue.labels?.map((l) => l.name) ?? []
      const [linked] = await db
        .select({ r: reports, gi: githubIntegrations })
        .from(reports)
        .innerJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
        .where(
          and(
            eq(reports.githubIssueNumber, p.issue.number),
            eq(githubIntegrations.repoOwner, p.repository.owner.login),
            eq(githubIntegrations.repoName, p.repository.name),
          ),
        )
        .limit(1)

      if (linked) {
        const { priority, tags } = parseGithubLabels(issueLabels, linked.gi.defaultLabels)

        const priorityChanged = priority !== null && priority !== linked.r.priority
        const currentTagSet = new Set(linked.r.tags)
        const desiredTagSet = new Set(tags)
        const addedTags = tags.filter((t) => !currentTagSet.has(t))
        const removedTags = linked.r.tags.filter((t) => !desiredTagSet.has(t))
        const tagsChanged = addedTags.length > 0 || removedTags.length > 0

        if (priorityChanged || tagsChanged) {
          // priority is non-null here: priorityChanged = (priority !== null && …)
          const nextPriority = priority ?? linked.r.priority
          await db.transaction(async (tx) => {
            await tx
              .update(reports)
              .set({
                ...(priorityChanged ? { priority: nextPriority } : {}),
                ...(tagsChanged ? { tags } : {}),
                updatedAt: new Date(),
              })
              .where(eq(reports.id, linked.r.id))

            const eventsToInsert: (typeof reportEvents.$inferInsert)[] = []

            if (priorityChanged) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "priority_changed",
                payload: { from: linked.r.priority, to: priority, source: "github" },
              })
            }
            for (const tag of addedTags) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "tag_added",
                payload: { tag, source: "github" },
              })
            }
            for (const tag of removedTags) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "tag_removed",
                payload: { tag, source: "github" },
              })
            }

            if (eventsToInsert.length > 0) {
              await tx.insert(reportEvents).values(eventsToInsert)
            }
          })
        }
      }
    }
  }

  setResponseStatus(event, 202)
  return { ok: true }
})
