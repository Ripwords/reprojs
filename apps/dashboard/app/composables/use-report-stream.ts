// apps/dashboard/app/composables/use-report-stream.ts
//
// Client-side subscription to the per-report SSE endpoint. Wraps VueUse's
// `useEventSource` and invokes the caller's handler for each message.
//
// Memory-safety design:
//   - `useEventSource` already teardowns the underlying EventSource on
//     `onScopeDispose`, which Vue fires when the component's setup scope
//     ends (route change, unmount). We additionally call `close()` in
//     `onBeforeUnmount` as a belt-and-suspenders hook.
//   - The `watch` we register on `data` is automatically disposed with the
//     component's setup scope — no manual `stop()` needed, assuming the
//     composable is only used inside `<script setup>` (the documented
//     contract; Vue warns at runtime if called outside a setup context).
//   - Reconnect is bounded: 10 retries with 2-second backoff. After that
//     the stream goes silent rather than retrying forever. Users get the
//     same data via the next page load or a manual refresh trigger.
//   - Parse errors from malformed server payloads are swallowed — a bad
//     single event must not tear down the stream.

import { onBeforeUnmount, watch } from "vue"
import { useEventSource } from "@vueuse/core"

export type ReportStreamEvent = {
  kind:
    | "triage"
    | "comment_added"
    | "comment_edited"
    | "comment_deleted"
    | "github_synced"
    | "github_unlinked"
  payload?: Record<string, unknown>
}

export function useReportStream(
  projectId: () => string,
  reportId: () => string,
  onEvent: (event: ReportStreamEvent) => void,
) {
  const url = computed(() => `/api/projects/${projectId()}/reports/${reportId()}/stream`)

  const { data, status, close } = useEventSource(url, [], {
    autoReconnect: {
      retries: 10,
      delay: 2_000,
      onFailed() {
        // Silent after bounded retries — a forever-retry loop burns battery
        // on mobile clients and adds server load during outages.
        console.warn("[report-stream] giving up after 10 reconnect attempts")
      },
    },
  })

  watch(data, (raw) => {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as ReportStreamEvent
      onEvent(parsed)
    } catch {
      // Malformed payload — ignore rather than break the stream.
    }
  })

  // useEventSource registers an onScopeDispose internally, but an extra
  // close() on unmount is harmless (the library no-ops repeat closes) and
  // keeps the lifecycle intent explicit at the call-site level.
  onBeforeUnmount(() => {
    close()
  })

  return { status }
}
