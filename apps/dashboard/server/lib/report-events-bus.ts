// apps/dashboard/server/lib/report-events-bus.ts
//
// In-process pub/sub for live report updates. Every write-site (triage PATCH,
// comment create/edit/delete, GitHub webhook branches) publishes a minimal
// event after commit; the SSE endpoint at
// `GET /api/projects/:id/reports/:reportId/stream` forwards matching events
// to subscribed browser tabs.
//
// Memory-safety invariants (verify before editing):
//   1. `listeners` entries are removed the moment the last subscriber for a
//      reportId unsubscribes — no lingering empty Sets.
//   2. Each listener carries a `dead` flag; `publishReportStream` skips dead
//      listeners AND lazily evicts them. A listener marked dead is guaranteed
//      to be unreachable from the bus within the next publish tick.
//   3. Per-report subscriber cap (`MAX_SUBSCRIBERS_PER_REPORT`) protects
//      against runaway clients looping reconnects.
//   4. A listener that throws repeatedly is auto-unsubscribed by the caller
//      (the SSE endpoint) after `LISTENER_FAILURE_THRESHOLD` consecutive
//      failures — see `report-events-subscriber.ts` usage. The bus itself
//      only swallows one failure at a time; persistence detection lives with
//      the subscriber so the bus stays provider-agnostic.
//
// Single-node only. A horizontally-scaled deployment would replace the
// in-memory Map with a Redis pub/sub (or Postgres LISTEN/NOTIFY) so each
// Nitro worker sees writes committed by its peers.

export type ReportStreamEvent = {
  /** Stable string the client switches on to decide what to refresh. */
  kind:
    | "triage"
    | "comment_added"
    | "comment_edited"
    | "comment_deleted"
    | "github_synced"
    | "github_unlinked"
  /** Optional extra context; kept small (no full row) so the client can decide what to refetch. */
  payload?: Record<string, unknown>
}

type Listener = (event: ReportStreamEvent) => void | Promise<void>

type ListenerEntry = {
  fn: Listener
  dead: boolean
}

/** Hard cap to defend against subscription floods from a buggy client. */
export const MAX_SUBSCRIBERS_PER_REPORT = 20

const listeners = new Map<string, Set<ListenerEntry>>()

/**
 * Subscribe to a report's stream. Returns an unsubscribe function that is
 * idempotent and safe to call from any lifecycle hook (including after the
 * bus has already evicted the entry on its own).
 *
 * Throws if the per-report cap is exceeded so the SSE endpoint can respond
 * with a visible 429 rather than silently dropping subscribers.
 */
export function subscribeReportStream(reportId: string, fn: Listener): () => void {
  let set = listeners.get(reportId)
  if (!set) {
    set = new Set()
    listeners.set(reportId, set)
  }
  if (set.size >= MAX_SUBSCRIBERS_PER_REPORT) {
    throw new Error(
      `Too many active subscribers for report ${reportId} (cap ${MAX_SUBSCRIBERS_PER_REPORT})`,
    )
  }
  const entry: ListenerEntry = { fn, dead: false }
  set.add(entry)
  return () => {
    entry.dead = true
    const current = listeners.get(reportId)
    if (!current) return
    current.delete(entry)
    if (current.size === 0) listeners.delete(reportId)
  }
}

/**
 * Fire-and-forget publish. Iterates a snapshot of listeners so concurrent
 * unsubscribes during dispatch don't mutate the iterator. Dead entries are
 * lazily reaped on visit. A listener throwing does not stop peers from
 * receiving the event, but the exception is swallowed — callers that need
 * failure tracking (the SSE endpoint) wrap their own fn to count failures.
 */
export function publishReportStream(reportId: string, event: ReportStreamEvent): void {
  const set = listeners.get(reportId)
  if (!set) return
  const snapshot = Array.from(set)
  for (const entry of snapshot) {
    if (entry.dead) {
      set.delete(entry)
      continue
    }
    try {
      // Listeners may return a Promise — ignore it. We don't await to keep
      // publish synchronous from the caller's perspective.
      void entry.fn(event)
    } catch {
      // Subscriber misbehaved. Its fallout is isolated from peers.
    }
  }
  if (set.size === 0) listeners.delete(reportId)
}

/** Diagnostic helper — returns the active subscriber count for a report. */
export function subscriberCount(reportId: string): number {
  return listeners.get(reportId)?.size ?? 0
}

/** Diagnostic helper — total listeners across all reports. */
export function totalSubscriberCount(): number {
  let n = 0
  for (const set of listeners.values()) n += set.size
  return n
}

/** Test-only: clear all listeners. */
export function __resetReportStreamBus(): void {
  listeners.clear()
}
