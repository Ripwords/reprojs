import { createError, defineEventHandler, getHeader, getRequestIP, readMultipartFormData } from "h3"
import { and, count, eq, gte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { LogsAttachment, ReportIntakeInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projects, reports, reportAttachments } from "../../db/schema"
import { applyIntakeCors, isOriginAllowed } from "../../lib/intake-cors"
import { enqueueSync } from "../../lib/enqueue-sync"
import { env } from "../../lib/env"
import { getAnonKeyLimiter, getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"

const MAX_BYTES = env.INTAKE_MAX_BYTES
// Only trust X-Forwarded-For when the deployment is behind a reverse proxy the
// operator controls. Default OFF so a public deployment can't be trivially
// rate-limit bypassed by spoofing the header.
const TRUST_XFF = env.TRUST_XFF
const MIN_DWELL_MS = env.INTAKE_MIN_DWELL_MS
const REQUIRE_DWELL = env.INTAKE_REQUIRE_DWELL

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
  const ip = getRequestIP(event, { xForwardedFor: TRUST_XFF }) ?? "unknown"

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

  // Origin allowlist MUST be checked before the rate limiter takes, otherwise
  // an attacker with just a leaked project key can burn the legitimate SDK's
  // quota from any origin (including origins not on the allowlist).
  if (!isOriginAllowed(origin, project.allowedOrigins)) {
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  // S1: Honeypot check BEFORE rate-limit takes. Bots that set _hp must not
  // consume quota — tarpit them cheaply without burning the project's budget.
  if (parsed._hp && parsed._hp.length > 0) {
    // Tarpit: look successful to the attacker so they don't switch tactics.
    // Fake UUID, no DB write, no enqueue.
    event.node.res.statusCode = 201
    return { id: randomUUID() }
  }

  // S2: Require _dwellMs to be present and above the minimum. Bots that omit
  // the field entirely are now rejected. Opt-out via INTAKE_REQUIRE_DWELL=false
  // during SDK rollout to avoid breaking older SDK versions.
  if (REQUIRE_DWELL && (parsed._dwellMs === undefined || parsed._dwellMs < MIN_DWELL_MS)) {
    throw createError({ statusCode: 400, statusMessage: "Submission too fast" })
  }

  // P4: Fetch both limiters and fire both takes in parallel to halve the
  // round-trip count when RATE_LIMIT_STORE=postgres.
  const isAnon = !parsed.context.reporter?.userId
  const keyLimiter = await (isAnon ? getAnonKeyLimiter() : getKeyLimiter())
  const ipLimiter = await getIpLimiter()
  const [keyTake, ipTake] = await Promise.all([
    keyLimiter.take(`${isAnon ? "anon" : "key"}:${project.id}`),
    ipLimiter.take(`ip:${ip}`),
  ])
  if (!keyTake.allowed || !ipTake.allowed) {
    const retryAfterMs = Math.max(
      keyTake.allowed ? 0 : keyTake.retryAfterMs,
      ipTake.allowed ? 0 : ipTake.retryAfterMs,
    )
    event.node.res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString())
    const message = !keyTake.allowed
      ? "Too many reports for this project"
      : "Too many reports from this IP"
    throw createError({ statusCode: 429, statusMessage: message })
  }

  const logsPart = parts.find((p) => p.name === "logs")
  let parsedLogs: ReturnType<typeof LogsAttachment.parse> | null = null
  if (logsPart?.data && logsPart.data.length > 0) {
    try {
      parsedLogs = LogsAttachment.parse(JSON.parse(logsPart.data.toString("utf8")))
    } catch {
      throw createError({ statusCode: 400, statusMessage: "Invalid logs payload" })
    }
  }

  const screenshotPart = parts.find((p) => p.name === "screenshot")

  // SEC2: Daily ceiling — hard cap on reports per project per rolling 24h
  // window. Previously the COUNT and INSERT ran in separate statements which
  // allowed concurrent requests to all observe count = cap-1 and each commit
  // an insert, breaching the cap by up to (concurrency - 1) per burst.
  //
  // Fix: wrap the count-check + insert in a single transaction guarded by a
  // pg_advisory_xact_lock keyed on (project_id, rolling window start). The
  // lock serializes only intakes for the same project — other projects are
  // unaffected, and readers outside this path are never blocked. Advisory
  // locks avoid the retry storms a full SERIALIZABLE isolation would produce.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const txResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`intake:${project.id}:daily`}))`)

    const [countRow] = await tx
      .select({ c: count() })
      .from(reports)
      .where(and(eq(reports.projectId, project.id), gte(reports.createdAt, dayAgo)))
    const todayCount = countRow?.c ?? 0
    if (todayCount >= project.dailyReportCap) {
      return { overCap: true as const }
    }

    const [inserted] = await tx
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
    return { overCap: false as const, report: inserted }
  })

  if (txResult.overCap) {
    event.node.res.setHeader("Retry-After", "3600")
    throw createError({ statusCode: 429, statusMessage: "Daily report cap reached" })
  }
  const report = txResult.report
  if (!report) {
    throw createError({ statusCode: 500, statusMessage: "Insert failed" })
  }

  // P3: Call getStorage() once and fan out attachment writes with Promise.all.
  // Screenshot and logs uploads no longer serialize.
  const screenshotData =
    screenshotPart?.data && screenshotPart.data.length > 0 ? screenshotPart.data : null
  const logsData = parsedLogs && logsPart?.data ? logsPart.data : null
  if (screenshotData !== null || logsData !== null) {
    const storage = await getStorage()
    const writes: Promise<void>[] = []
    if (screenshotData !== null) {
      const key = `${report.id}/screenshot.png`
      writes.push(
        storage
          .put(key, new Uint8Array(screenshotData), "image/png")
          .then(() =>
            db.insert(reportAttachments).values({
              reportId: report.id,
              kind: "screenshot",
              storageKey: key,
              contentType: "image/png",
              sizeBytes: screenshotData.length,
            }),
          )
          .then(() => undefined),
      )
    }
    if (logsData !== null) {
      const key = `${report.id}/logs.json`
      writes.push(
        storage
          .put(key, new Uint8Array(logsData), "application/json")
          .then(() =>
            db.insert(reportAttachments).values({
              reportId: report.id,
              kind: "logs",
              storageKey: key,
              contentType: "application/json",
              sizeBytes: logsData.length,
            }),
          )
          .then(() => undefined),
      )
    }
    await Promise.all(writes)
  }

  await enqueueSync(report.id, project.id).catch((err) => {
    console.error("[github] enqueueSync failed on intake", err)
  })

  event.node.res.statusCode = 201
  return { id: report.id }
})
