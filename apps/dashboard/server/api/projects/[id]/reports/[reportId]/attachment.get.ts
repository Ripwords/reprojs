import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setHeader,
  setResponseStatus,
} from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportAttachments, reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getStorage } from "../../../../../lib/storage"
import { verifyAttachmentToken } from "../../../../../lib/signed-attachment-url"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }

  const q = getQuery(event)
  const kindRaw = q.kind
  const kind = typeof kindRaw === "string" ? kindRaw : "screenshot"

  // Signed-token fast path: used by GitHub-embedded screenshot URLs, no session.
  const tokenRaw = q.token
  const expiresRaw = q.expires
  if (typeof tokenRaw === "string" && typeof expiresRaw === "string") {
    const expiresAt = Number.parseInt(expiresRaw, 10)
    if (!Number.isFinite(expiresAt)) {
      throw createError({ statusCode: 401, statusMessage: "Invalid token" })
    }
    const secret = process.env.ATTACHMENT_URL_SECRET
    if (!secret) {
      throw createError({ statusCode: 500, statusMessage: "ATTACHMENT_URL_SECRET not set" })
    }
    const ok = verifyAttachmentToken({
      secret,
      projectId,
      reportId,
      kind,
      expiresAt,
      token: tokenRaw,
    })
    if (!ok) {
      throw createError({ statusCode: 401, statusMessage: "Invalid or expired token" })
    }
  } else {
    await requireProjectRole(event, projectId, "viewer")
  }

  const [row] = await db
    .select({
      storageKey: reportAttachments.storageKey,
      contentType: reportAttachments.contentType,
    })
    .from(reportAttachments)
    .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
    .where(
      and(
        eq(reportAttachments.reportId, reportId),
        eq(
          reportAttachments.kind,
          kind as "screenshot" | "annotated-screenshot" | "replay" | "logs",
        ),
        eq(reports.projectId, projectId),
      ),
    )
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: "Attachment not found" })

  const storage = await getStorage()
  const { bytes, contentType } = await storage.get(row.storageKey)

  // Allowlist the content type: never serve what was stored if it's not one of
  // the kinds the intake endpoint legitimately writes. This blocks stored-XSS
  // via a spoofed text/html content type regardless of what lands on disk.
  const SAFE_CONTENT_TYPES: Record<string, string> = {
    screenshot: "image/png",
    "annotated-screenshot": "image/png",
    replay: "application/json",
    logs: "application/json",
  }
  const safeType = SAFE_CONTENT_TYPES[kind] ?? "application/octet-stream"

  setHeader(event, "Content-Type", safeType)
  setHeader(event, "X-Content-Type-Options", "nosniff")
  setHeader(event, "Content-Security-Policy", "default-src 'none'; img-src 'self' data:; sandbox")
  setHeader(event, "Cache-Control", "private, max-age=3600")
  setResponseStatus(event, 200)
  // Mark `contentType` intentionally unused — we allowlist the served type.
  void contentType
  return Buffer.from(bytes)
})
