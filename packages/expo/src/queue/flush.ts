import type { QueueStorage } from "./storage"
import type { IntakeClient } from "../intake-client"

export interface QueueFlusher {
  flush: () => Promise<void>
}

export function createQueueFlusher(opts: {
  queue: QueueStorage
  client: IntakeClient
  backoffMs: number[]
}): QueueFlusher {
  let running = false

  async function flush() {
    if (running) return
    running = true
    try {
      const items = await opts.queue.all()
      // eslint-disable-next-line no-await-in-loop
      for (const item of items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await opts.client.submit({
            idempotencyKey: item.id,
            input: item.payload.input,
            attachments: item.payload.attachments.map((a) => ({
              ...a,
              contentType:
                a.kind === "annotated-screenshot" || a.kind === "screenshot"
                  ? "image/png"
                  : "application/json",
            })),
          })
          // eslint-disable-next-line no-await-in-loop
          await opts.queue.remove(item.id)
        } catch (err) {
          const status = (err as { status?: number }).status ?? 0
          const retryable = (err as { retryable?: boolean }).retryable ?? status >= 500
          if (!retryable && status >= 400 && status !== 429) {
            // eslint-disable-next-line no-await-in-loop
            await opts.queue.remove(item.id)
          } else {
            // eslint-disable-next-line no-await-in-loop
            await opts.queue.update(item.id, {
              attempts: item.attempts + 1,
              lastError: (err as Error).message,
              lastErrorAt: new Date().toISOString(),
            })
          }
        }
      }
    } finally {
      running = false
    }
  }

  return { flush }
}
