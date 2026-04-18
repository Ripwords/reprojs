// apps/dashboard/server/api/integrations/github/webhook.post.ts
import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus } from "h3"
import { and, eq } from "drizzle-orm"
import { verifyWebhookSignature } from "@feedback-tool/integrations-github"
import { db } from "../../../db"
import { githubIntegrations, reportEvents, reports } from "../../../db/schema"
import { getWebhookSecret } from "../../../lib/github"

// GitHub's own webhook deliveries are bounded by their 25 MB delivery cap, but
// a direct attacker posting to this URL could otherwise stream an arbitrary
// amount into memory before the HMAC check rejects them. 1 MB comfortably fits
// any real Issues / Installation event payload.
const MAX_BYTES = Number(process.env.GITHUB_WEBHOOK_MAX_BYTES ?? 1_048_576)

interface IssuesPayload {
  action: "opened" | "closed" | "reopened" | "edited" | "deleted" | string
  issue: {
    number: number
    state: "open" | "closed"
    state_reason?: "completed" | "not_planned" | null
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
  const contentLength = Number(getHeader(event, "content-length") ?? 0)
  if (contentLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }
  const raw = await readRawBody(event)
  if (!raw || typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  // Fallback guard when Content-Length is missing or understated (chunked).
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }
  const sig = getHeader(event, "x-hub-signature-256")
  if (
    !sig ||
    !verifyWebhookSignature({ secret: getWebhookSecret(), payload: raw, signatureHeader: sig })
  ) {
    throw createError({ statusCode: 401, statusMessage: "invalid signature" })
  }

  const kind = getHeader(event, "x-github-event")
  const payload = JSON.parse(raw) as Record<string, unknown>

  if (kind === "installation") {
    const p = payload as unknown as InstallationPayload
    if (p.action === "deleted" || p.action === "suspend") {
      await db
        .update(githubIntegrations)
        .set({ status: "disconnected", updatedAt: new Date() })
        .where(eq(githubIntegrations.installationId, p.installation.id))
    }
  } else if (kind === "installation_repositories") {
    const p = payload as unknown as InstallationReposPayload
    if (p.action === "removed" && p.repositories_removed?.length) {
      const removedNames = p.repositories_removed.map((r) => r.full_name)
      const rows = await db
        .select()
        .from(githubIntegrations)
        .where(eq(githubIntegrations.installationId, p.installation.id))
      for (const row of rows) {
        if (removedNames.includes(`${row.repoOwner}/${row.repoName}`)) {
          await db
            .update(githubIntegrations)
            .set({ status: "disconnected", updatedAt: new Date() })
            .where(eq(githubIntegrations.projectId, row.projectId))
        }
      }
    }
  } else if (kind === "issues") {
    const p = payload as unknown as IssuesPayload
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
            actorId: null,
            kind: "status_changed",
            payload: { from: linked.r.status, to: desired, source: "github" },
          })
        })
      }
    }
  }

  setResponseStatus(event, 202)
  return { ok: true }
})
