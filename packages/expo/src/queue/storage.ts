import AsyncStorage from "@react-native-async-storage/async-storage"
import type { ReportIntakeInput, AttachmentKind } from "@reprojs/shared"

const STORAGE_KEY = "@reprojs/expo/queue/v1"

export interface QueueItemAttachment {
  kind: AttachmentKind
  uri: string
  bytes: number
}

export interface QueueItem {
  id: string
  createdAt: string
  payload: {
    input: ReportIntakeInput
    attachments: QueueItemAttachment[]
    logs?: string
  }
  attempts: number
  lastErrorAt: string | null
  lastError: string | null
}

interface QueueFile {
  items: QueueItem[]
  sizeBytes: number
}

function itemBytes(i: QueueItem): number {
  return i.payload.attachments.reduce((sum, a) => sum + a.bytes, 0)
}

export interface QueueStorage {
  all: () => Promise<QueueItem[]>
  enqueue: (item: QueueItem) => Promise<{ evictedIds: string[] }>
  update: (id: string, patch: Partial<QueueItem>) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

async function read(): Promise<QueueFile> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (!raw) return { items: [], sizeBytes: 0 }
  try {
    const parsed = JSON.parse(raw) as QueueFile
    return parsed
  } catch {
    return { items: [], sizeBytes: 0 }
  }
}

async function write(file: QueueFile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(file))
}

export function createQueueStorage(opts: { maxReports: number; maxBytes: number }): QueueStorage {
  return {
    async all() {
      const f = await read()
      return f.items
    },
    async enqueue(item) {
      const f = await read()
      const evicted: string[] = []
      f.items.push(item)
      f.sizeBytes += itemBytes(item)
      while (f.items.length > opts.maxReports || f.sizeBytes > opts.maxBytes) {
        const head = f.items.shift()
        if (!head) break
        evicted.push(head.id)
        f.sizeBytes -= itemBytes(head)
      }
      await write(f)
      return { evictedIds: evicted }
    },
    async update(id, patch) {
      const f = await read()
      const idx = f.items.findIndex((i) => i.id === id)
      if (idx === -1) return
      const current = f.items[idx]
      if (!current) return
      f.items[idx] = { ...current, ...patch }
      await write(f)
    },
    async remove(id) {
      const f = await read()
      const idx = f.items.findIndex((i) => i.id === id)
      if (idx === -1) return
      const removed = f.items[idx]
      if (removed) f.sizeBytes -= itemBytes(removed)
      f.items.splice(idx, 1)
      await write(f)
    },
    async clear() {
      await AsyncStorage.removeItem(STORAGE_KEY)
    },
  }
}
