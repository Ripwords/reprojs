import { createError, defineEventHandler, getHeader, getRequestIP, readMultipartFormData } from "h3"
import { and, count, eq, gte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { LogsAttachment, ReportIntakeInput } from "@reprojs/shared"
import { db } from "../../db"
import { githubIntegrations, projects, reports, reportAttachments } from "../../db/schema"
import {
  applyIntakePostCors,
  applyIntakePreflightCors,
  isOriginAllowed,
} from "../../lib/intake-cors"
import { enqueueSync } from "../../lib/enqueue-sync"
import { env } from "../../lib/env"
import { getAnonKeyLimiter, getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"
import { sanitizeFilename } from "../../lib/sanitize-filename"
import { rollbackPuts } from "../../lib/storage/rollback"

const DENIED_USER_FILE_MIMES = new Set([
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-executable",
])
const DENIED_USER_FILE_EXTS = [".exe", ".bat", ".cmd", ".com", ".scr", ".sh", ".ps1", ".vbs"]

export default defineEventHandler(async (event) => {
  // Preflight reflects Origin so browsers can proceed with the real POST.
  // No response body reads happen on preflight, so this is safe.
  if (event.method === "OPTIONS") {
    applyIntakePreflightCors(event)
    event.node.res.statusCode = 204
    return ""
  }

  if (event.method !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
  }

  const rawOrigin = getHeader(event, "origin") ?? ""
  // When an extension service worker posts on behalf of a tester, the
  // browser sets Origin to chrome-extension://<id> — unforgeable from
  // a regular webpage. In that narrow case, fall back to the page origin
  // the extension captured client-side and forwarded via X-Repro-Origin.
  // Regular JS in a page cannot set a chrome-extension:// Origin, so this
  // fallback is only reachable from an installed extension, which is a
  // much higher bar than the standard leaked-project-key threat the
  // Origin allowlist is meant to defend against.
  // If rawOrigin is empty (mobile/Expo — no browser-set Origin), leave
  // origin as "" and defer the allow/reject decision until after parsing,
  // where we can check parsed.context.source.
  const origin =
    rawOrigin.length > 0 && rawOrigin.startsWith("chrome-extension://")
      ? (getHeader(event, "x-repro-origin") ?? "")
      : rawOrigin
  // TRUST_XFF is OFF by default — a public deployment must not be trivially
  // rate-limit-bypassed via a spoofed X-Forwarded-For header.
  const ip = getRequestIP(event, { xForwardedFor: env.TRUST_XFF }) ?? "unknown"

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
  if (totalBytes > env.INTAKE_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }

  const reportPart = parts.find((p) => p.name === "report")
  if (!reportPart) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'report' part" })
  }

  let parsed: ReturnType<typeof ReportIntakeInput.parse>
  try {
    parsed = ReportIntakeInput.parse(JSON.parse(reportPart.data.toString("utf8")))
  } catch (err) {
    // Log the zod issues server-side so SDK authors can see exactly which field failed.
    // Safe to log at warn level — payloads that reach here have already passed origin +
    // project-key checks, so they're from legit callers submitting malformed shapes.
    const issues =
      err && typeof err === "object" && "issues" in err
        ? (err as { issues: unknown }).issues
        : String(err)
    console.warn("[intake] invalid report payload", JSON.stringify(issues, null, 2))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid report payload",
      data: { issues },
    })
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.publicKey, parsed.projectKey))
    .limit(1)
  if (!project || project.deletedAt) {
    throw createError({ statusCode: 401, statusMessage: "Invalid project key" })
  }

  const idempotencyKey = getHeader(event, "idempotency-key") ?? null

  // Origin allowlist MUST be checked before the rate limiter takes, otherwise
  // an attacker with just a leaked project key can burn the legitimate SDK's
  // quota from any origin (including origins not on the allowlist).
  // For Expo (mobile) callers there is no browser-set Origin — allow empty
  // origin only when parsed.context.source === "expo".
  const allowEmptyOrigin = parsed.context.source === "expo"
  if (!isOriginAllowed(origin, project.allowedOrigins, { allowEmpty: allowEmptyOrigin })) {
    // Deliberately do NOT emit ACAO here — cross-origin scripts cannot read
    // this 403 body, which removes the cross-origin enumeration oracle.
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  // Origin validated: emit ACAO so the legitimate SDK (on this allowed origin)
  // can read both success AND error bodies of the rest of this request.
  // Use the RAW origin for CORS — the browser checks ACAO against the fetch
  // client's actual origin, which for an extension SW proxy is
  // chrome-extension://<id>, not the page-origin fallback we accepted above.
  // For Expo (no browser), rawOrigin is empty — skip ACAO entirely.
  if (rawOrigin) {
    applyIntakePostCors(event, rawOrigin)
  }

  // Idempotency short-circuit: if a client replays a request with the same
  // Idempotency-Key for this project, return the existing report id without
  // re-inserting. This runs BEFORE honeypot/dwell gates so legitimate mobile
  // retries always get a stable response even if those gates would reject.
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.projectId, project.id), eq(reports.idempotencyKey, idempotencyKey)))
      .limit(1)
    if (existing) {
      event.node.res.statusCode = 200
      return { id: existing.id }
    }
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
  if (
    env.INTAKE_REQUIRE_DWELL &&
    (parsed._dwellMs === undefined || parsed._dwellMs < env.INTAKE_MIN_DWELL_MS)
  ) {
    throw createError({ statusCode: 400, statusMessage: "Submission too fast" })
  }

  // P4: Fetch both limiters and fire both takes in parallel to halve the
  // round-trip count when RATE_LIMIT_STORE=postgres.
  const isAnon = !parsed.context.reporter?.userId
  const keyLimiter = await (isAnon ? getAnonKeyLimiter() : getKeyLimiter())
  const ipLimiter = await getIpLimiter()
  const [keyTake, ipTake] = await Promise.all([
    keyLimiter.take(`${isAnon ? "anon" : "key"}:${project.id}:${parsed.context.source}`),
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
        source: parsed.context.source,
        devicePlatform: parsed.context.systemInfo?.devicePlatform ?? null,
        idempotencyKey,
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

  const replayPart = parts.find((p) => p.name === "replay")
  const replayFeatureOn = env.REPLAY_FEATURE_ENABLED
  const projectAllowsReplay = project.replayEnabled
  const replayDisabled = !replayFeatureOn || !projectAllowsReplay
  let replayStored = false

  if (replayPart?.data && replayPart.data.length > 0) {
    if (replayPart.data.length > env.INTAKE_REPLAY_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Replay payload too large" })
    }
    if (replayDisabled) {
      // Silently drop — success-with-signal semantics (see spec §6).
    } else {
      const storage = await getStorage()
      const key = `${report.id}/replay.json.gz`
      await storage.put(key, new Uint8Array(replayPart.data), "application/gzip")
      await db.insert(reportAttachments).values({
        reportId: report.id,
        kind: "replay",
        storageKey: key,
        contentType: "application/gzip",
        sizeBytes: replayPart.data.length,
      })
      replayStored = true
    }
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

  // ── User-supplied additional attachments (kind = "user-file") ────────────
  // Multipart parts are named attachment[0], attachment[1], … so a single
  // report can carry multiple files without colliding on a fixed part name.
  const userParts = parts.flatMap((p) => {
    const m = p.name?.match(/^attachment\[(\d+)\]$/)
    if (!m || !p.data || p.data.length === 0) return []
    return [{ idx: Number(m[1]), part: p }]
  })

  if (userParts.length > 0) {
    if (userParts.length > env.INTAKE_USER_FILES_MAX_COUNT) {
      throw createError({
        statusCode: 413,
        statusMessage: `Too many attachments (max ${env.INTAKE_USER_FILES_MAX_COUNT})`,
      })
    }
    let totalUserBytes = 0
    for (const { part } of userParts) {
      if (part.data.length > env.INTAKE_USER_FILE_MAX_BYTES) {
        throw createError({ statusCode: 413, statusMessage: "Attachment too large" })
      }
      const mime = part.type ?? "application/octet-stream"
      const lower = (part.filename ?? "").toLowerCase()
      if (
        DENIED_USER_FILE_MIMES.has(mime) ||
        DENIED_USER_FILE_EXTS.some((ext) => lower.endsWith(ext))
      ) {
        throw createError({
          statusCode: 415,
          statusMessage: `Attachment type not allowed: ${part.filename ?? "unnamed"}`,
        })
      }
      totalUserBytes += part.data.length
    }
    if (totalUserBytes > env.INTAKE_USER_FILES_TOTAL_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Attachments exceed total budget" })
    }

    const storage = await getStorage()
    const writtenKeys: string[] = []
    try {
      await Promise.all(
        userParts.map(async ({ idx, part }) => {
          const safeName = sanitizeFilename(part.filename ?? "", idx)
          const mime = part.type ?? "application/octet-stream"
          const key = `${report.id}/user/${idx}-${safeName}`
          await storage.put(key, new Uint8Array(part.data), mime)
          writtenKeys.push(key)
          await db.insert(reportAttachments).values({
            reportId: report.id,
            kind: "user-file",
            storageKey: key,
            contentType: mime,
            sizeBytes: part.data.length,
            filename: safeName,
          })
        }),
      )
    } catch (err) {
      await rollbackPuts(storage, writtenKeys)
      throw err
    }
  }

  // Auto-create GitHub issue on intake when the toggle is on.
  // Runs after all attachments are persisted so the sync worker sees them.
  // Fire-and-forget: enqueueSync is a single SQL UPSERT (microseconds), so a
  // plain await does not meaningfully delay the 201 response to the SDK.
  const [integration] = await db
    .select({
      status: githubIntegrations.status,
      autoCreateOnIntake: githubIntegrations.autoCreateOnIntake,
      repoOwner: githubIntegrations.repoOwner,
      repoName: githubIntegrations.repoName,
    })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, project.id))
    .limit(1)

  if (
    integration &&
    integration.status === "connected" &&
    integration.autoCreateOnIntake &&
    integration.repoOwner &&
    integration.repoName
  ) {
    await enqueueSync(report.id, project.id).catch((err) => {
      console.error("[github] enqueueSync failed on intake", err)
    })
  }

  event.node.res.statusCode = 201
  return {
    id: report.id,
    ...(replayPart ? { replayStored, replayDisabled } : {}),
  }
})
