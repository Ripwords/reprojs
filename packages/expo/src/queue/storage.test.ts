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

const { createQueueStorage } = await import("./storage")

test("enqueue persists and read returns items", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 5, maxBytes: 1024 * 1024 })
  await q.enqueue({
    id: "id-1",
    createdAt: new Date().toISOString(),
    payload: { input: { title: "t" } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  const items = await q.all()
  expect(items).toHaveLength(1)
  expect(items[0]?.id).toBe("id-1")
})

test("enqueue evicts the oldest when over maxReports", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 2, maxBytes: 1024 * 1024 })
  for (const id of ["a", "b", "c"]) {
    await q.enqueue({
      id,
      createdAt: new Date().toISOString(),
      payload: {
        input: { title: id } as never,
        attachments: [{ kind: "logs", uri: "file://x", bytes: 10 }],
      },
      attempts: 0,
      lastErrorAt: null,
      lastError: null,
    })
  }
  const items = await q.all()
  expect(items.map((i) => i.id)).toEqual(["b", "c"])
})

test("enqueue evicts when over maxBytes", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 20 })
  await q.enqueue({
    id: "big",
    createdAt: new Date().toISOString(),
    payload: {
      input: { title: "t" } as never,
      attachments: [{ kind: "logs", uri: "file://x", bytes: 15 }],
    },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  await q.enqueue({
    id: "bigger",
    createdAt: new Date().toISOString(),
    payload: {
      input: { title: "t" } as never,
      attachments: [{ kind: "logs", uri: "file://y", bytes: 15 }],
    },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  const items = await q.all()
  expect(items.map((i) => i.id)).toEqual(["bigger"])
})

test("remove deletes by id", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 5, maxBytes: 1024 })
  await q.enqueue({
    id: "k",
    createdAt: new Date().toISOString(),
    payload: { input: { title: "t" } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  await q.remove("k")
  expect(await q.all()).toEqual([])
})
