// apps/dashboard/server/api/projects/[id]/reports/[reportId]/stream.get.ts
//
// Server-Sent Events endpoint that pushes live updates for a single report to
// the browser. Replaces the drawer's 20-second polling with immediate refetch
// triggers. Events are small ({kind, payload?}) — the client decides what to
// refresh based on the kind.
//
// Auth: same `viewer+` gate as the report detail endpoint. The session cookie
// piggy-backs on the EventSource connection automatically.
//
// Memory-safety design (match against report-events-bus.ts invariants):
//
//   Cleanup is idempotent and triggered from THREE paths so no single
//   failure mode leaks:
//     (a) `stream.onClosed(...)` — the happy path, h3's own lifecycle hook
//     (b) the underlying Node request's `close` event — fires even if h3's
//         higher-level handler was bypassed (exception mid-dispatch, for
//         example)
//     (c) the self-eviction guard below — consecutive push failures beyond
//         LISTENER_FAILURE_THRESHOLD mark the subscriber dead so subsequent
//         publishes drop it from the bus
//
//   A single `cleanup()` function is wired into all three; it's guarded by a
//   `cleanedUp` flag so duplicate invocations are no-ops (no double-free of
//   the heartbeat interval, no double-unsubscribe).
//
//   The heartbeat interval MUST be cleared by cleanup even if the push inside
//   it fails — we swallow its rejection with `.catch(() => {})` and do not
//   treat heartbeat pushes as failures (they shouldn't evict real event
//   subscribers).
//
//   A 25-second comment-line heartbeat keeps intermediaries (Cloudflare,
//   reverse proxies) from idling the connection — shorter than Cloudflare's
//   100-second default idle timeout.

import { createError, createEventStream, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"
import {
  MAX_SUBSCRIBERS_PER_REPORT,
  subscribeReportStream,
  type ReportStreamEvent,
} from "../../../../../lib/report-events-bus"

const HEARTBEAT_MS = 25_000
const LISTENER_FAILURE_THRESHOLD = 3

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "viewer")

  // Confirm the report exists in this project — avoids leaking existence of
  // reports from other projects the viewer can't access.
  const [row] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "report not found" })
  }

  const stream = createEventStream(event)

  // Shared lifecycle state. The listener counts its own push failures so a
  // dead client doesn't keep occupying a bus slot.
  let consecutiveFailures = 0
  let cleanedUp = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    if (unsubscribe) {
      try {
        unsubscribe()
      } catch {
        // already unsubscribed — idempotent by design
      }
      unsubscribe = null
    }
  }

  async function write(payload: ReportStreamEvent) {
    try {
      await stream.push({ data: JSON.stringify(payload) })
      consecutiveFailures = 0
    } catch {
      consecutiveFailures++
      if (consecutiveFailures >= LISTENER_FAILURE_THRESHOLD) {
        // Client is gone or stuck — stop burdening the bus with this
        // subscriber. cleanup() is idempotent so the happy-path onClosed
        // / request-close hooks remain safe even after this self-eviction.
        cleanup()
      }
    }
  }

  try {
    unsubscribe = subscribeReportStream(reportId, write)
  } catch (err) {
    // Hit the per-report subscriber cap. Surface as 429 so the browser (or
    // a load test) gets clear signal rather than silently dropping events.
    throw createError({
      statusCode: 429,
      statusMessage:
        err instanceof Error
          ? err.message
          : `Too many subscribers (cap ${MAX_SUBSCRIBERS_PER_REPORT})`,
    })
  }

  // Initial "ready" marker so the client knows the stream is live.
  write({ kind: "triage", payload: { ready: true } })

  heartbeat = setInterval(() => {
    // Heartbeat pushes bypass the failure counter — a keepalive that can't
    // deliver doesn't meaningfully differ from the underlying connection
    // already being dead, and we DON'T want a transient backpressure blip on
    // the SSE transport to evict a live subscriber. The real-event path
    // (write()) is what drives eviction.
    stream.push(": keepalive\n\n").catch(() => {})
  }, HEARTBEAT_MS)

  // Primary cleanup hook — h3 signals this when the stream is closed by
  // either side (client disconnect, server .close(), error).
  stream.onClosed(cleanup)

  // Belt-and-suspenders: Node's underlying request also emits 'close' when
  // the socket dies. In rare paths where stream.onClosed is bypassed (an
  // exception thrown after the stream was established but before h3 wired up
  // its own listener, etc.), this still runs.
  try {
    event.node.req.once("close", cleanup)
  } catch {
    // Some test harnesses wrap event.node.req in a way that doesn't expose
    // `.once`. Non-fatal — onClosed is still the primary path.
  }

  return stream.send()
})
