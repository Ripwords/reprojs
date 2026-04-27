import type { StorageAdapter } from "."

/**
 * Best-effort delete of partially-written keys after a multi-write failure.
 * Each delete is awaited but errors are swallowed — orphaned blobs are
 * preferable to a half-failed report row, and the caller has already
 * decided to throw the original write error to the client.
 */
export async function rollbackPuts(storage: StorageAdapter, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key)
      } catch (err) {
        console.warn("[storage] rollback delete failed", { key, err: String(err) })
      }
    }),
  )
}
