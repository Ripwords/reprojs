import { test, expect, mock } from "bun:test"

const memory = new Map<string, string>()
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memory.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      memory.set(k, v)
    },
    removeItem: async (k: string) => {
      memory.delete(k)
    },
  },
}))

const { createQueueFlusher } = await import("./flush")
const { createQueueStorage } = await import("./storage")
type IntakeClient = import("../intake-client").IntakeClient

function fakeItem(id: string) {
  return {
    id,
    createdAt: new Date().toISOString(),
    payload: { input: { title: id } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  }
}

test("flush submits all items and removes on success", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("a"))
  await q.enqueue(fakeItem("b"))
  const submitted: string[] = []
  const client: IntakeClient = {
    submit: async ({ idempotencyKey }) => {
      submitted.push(idempotencyKey)
      return { id: "server-" + idempotencyKey }
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  expect(submitted.toSorted()).toEqual(["a", "b"])
  expect(await q.all()).toEqual([])
})

test("flush increments attempts on retryable error and keeps the item", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("500") as Error & { status?: number; retryable?: boolean }
      err.status = 503
      err.retryable = true
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  const items = await q.all()
  expect(items).toHaveLength(1)
  expect(items[0]?.attempts).toBe(1)
  expect(items[0]?.lastError).toContain("500")
})

test("flush drops the item on non-retryable 4xx", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("400") as Error & { status?: number; retryable?: boolean }
      err.status = 400
      err.retryable = false
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  expect(await q.all()).toEqual([])
})
