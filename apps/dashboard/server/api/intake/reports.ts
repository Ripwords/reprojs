import { createError, defineEventHandler, getHeader, getRequestIP, readMultipartFormData } from "h3"
import { eq } from "drizzle-orm"
import { ReportIntakeInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projects, reports, reportAttachments } from "../../db/schema"
import { applyIntakeCors, isOriginAllowed } from "../../lib/intake-cors"
import { getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"

const MAX_BYTES = Number(process.env.INTAKE_MAX_BYTES ?? 5 * 1024 * 1024)

export default defineEventHandler(async (event) => {
  applyIntakeCors(event)

  if (event.method === "OPTIONS") {
    event.node.res.statusCode = 204
    return ""
  }

  if (event.method !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
  }

  const origin = getHeader(event, "origin") ?? ""
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown"

  let parts: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    parts = await readMultipartFormData(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid multipart body" })
  }
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data" })
  }
  const totalBytes = parts.reduce((n, p) => n + (p.data?.length ?? 0), 0)
  if (totalBytes > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }

  const reportPart = parts.find((p) => p.name === "report")
  if (!reportPart) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'report' part" })
  }

  let parsed: ReturnType<typeof ReportIntakeInput.parse>
  try {
    parsed = ReportIntakeInput.parse(JSON.parse(reportPart.data.toString("utf8")))
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid report payload" })
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.publicKey, parsed.projectKey))
    .limit(1)
  if (!project || project.deletedAt) {
    throw createError({ statusCode: 401, statusMessage: "Invalid project key" })
  }

  const keyTake = getKeyLimiter().take(`key:${project.id}`)
  if (!keyTake.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(keyTake.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many reports for this project" })
  }
  const ipTake = getIpLimiter().take(`ip:${ip}`)
  if (!ipTake.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(ipTake.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many reports from this IP" })
  }

  if (!isOriginAllowed(origin, project.allowedOrigins)) {
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  const screenshotPart = parts.find((p) => p.name === "screenshot")
  const [report] = await db
    .insert(reports)
    .values({
      projectId: project.id,
      title: parsed.title,
      description: parsed.description ?? null,
      context: { ...parsed.context, ...(parsed.metadata ? { metadata: parsed.metadata } : {}) },
      origin,
      ip,
    })
    .returning()

  if (screenshotPart?.data && screenshotPart.data.length > 0) {
    const storage = await getStorage()
    const key = `attachments/${report.id}/screenshot.png`
    await storage.put(key, new Uint8Array(screenshotPart.data), "image/png")
    await db.insert(reportAttachments).values({
      reportId: report.id,
      kind: "screenshot",
      storageKey: key,
      contentType: "image/png",
      sizeBytes: screenshotPart.data.length,
    })
  }

  event.node.res.statusCode = 201
  return { id: report.id }
})
