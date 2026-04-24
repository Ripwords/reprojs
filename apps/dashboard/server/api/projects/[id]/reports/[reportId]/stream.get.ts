// apps/dashboard/server/api/projects/[id]/reports/[reportId]/stream.get.ts
//
// Server-Sent Events endpoint. Writes SSE frames directly to Node's raw
// response object rather than going through h3's `createEventStream` helper.
// The helper wraps writes in a web `TransformStream` that's piped via
// `sendStream` in Nitro's dev-mode response pipeline — somewhere in that
// chain frames buffer rather than flushing, so the browser sees an
// established connection with zero events even though `subscribers=1` on
// the bus and push() is called. Writing to `res.write` directly forces an
// immediate flush to the socket, which cloudflared / proxies pass straight
// through.

import { createError, defineEventHandler, getRouterParam } from "h3"
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

function formatFrame(payload: unknown): string {
  // SSE requires each `data:` line to end with `\n`; two `\n`s separate frames.
  const json = JSON.stringify(payload)
  return `data: ${json}\n\n`
}

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "viewer")

  const [row] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "report not found" })
  }

  const res = event.node.res
  const req = event.node.req

  // Tell Nitro we own the response. Without this flag h3 will try to send a
  // second response body after our handler returns, which breaks the stream.
  event._handled = true

  res.statusCode = 200
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  // Flush the headers immediately so the browser sees the 200 + content-type
  // before any frames. Some proxies won't start forwarding the body until
  // they've seen the full header block.
  if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === "function") {
    ;(res as unknown as { flushHeaders: () => void }).flushHeaders()
  }

  let consecutiveFailures = 0
  let cleanedUp = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  let resolveHandlerPromise: (() => void) | null = null

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
        // already unsubscribed — idempotent
      }
      unsubscribe = null
    }
    try {
      res.end()
    } catch {
      // Socket already torn down — non-fatal.
    }
    if (resolveHandlerPromise) {
      resolveHandlerPromise()
      resolveHandlerPromise = null
    }
  }

  function write(payload: ReportStreamEvent) {
    // Stamp each frame with a nonce so back-to-back identical payloads remain
    // distinct on the wire (defense in depth against any client-side caching).
    const envelope = {
      ...payload,
      nonce: `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    }
    try {
      const ok = res.write(formatFrame(envelope))
      if (!ok) {
        // Backpressure — socket buffer full. Not a failure, just informational.
        // Node will signal 'drain' when it's ready for more.
      }
      consecutiveFailures = 0
    } catch {
      consecutiveFailures++
      if (consecutiveFailures >= LISTENER_FAILURE_THRESHOLD) {
        cleanup()
      }
    }
  }

  // Register the 'close' listener BEFORE subscribing to the bus. A client
  // that disconnects in the tiny window between flushHeaders() and bus
  // subscription would otherwise have its close event fire into the void —
  // cleanup() never runs, the handler-awaited promise never resolves, the
  // request object stays pinned in memory, and (if we got as far as
  // subscribing) the bus accumulates a dead listener. Registering first
  // makes the cleanup path the FIRST thing ready to fire.
  req.once("close", cleanup)

  try {
    unsubscribe = subscribeReportStream(reportId, write)
  } catch (err) {
    cleanup()
    throw createError({
      statusCode: 429,
      statusMessage:
        err instanceof Error
          ? err.message
          : `Too many subscribers (cap ${MAX_SUBSCRIBERS_PER_REPORT})`,
    })
  }

  // Initial ready frame — lets the client know the connection is live, and
  // proves the write path end-to-end if nothing else happens for a while.
  write({ kind: "triage", payload: { ready: true } })

  heartbeat = setInterval(() => {
    try {
      // SSE comment line; clients ignore it, but it keeps intermediary proxies
      // from idling the connection closed.
      res.write(": keepalive\n\n")
    } catch {
      // Socket dead — cleanup will run via the 'close' listener registered above.
    }
  }, HEARTBEAT_MS)

  // Keep the handler alive until cleanup() runs — Nitro awaits this, which
  // keeps the response open so write() calls actually hit the socket.
  // Resolved by cleanup() via `resolveHandlerPromise`.
  await new Promise<void>((resolve) => {
    resolveHandlerPromise = resolve
  })

  return ""
})
