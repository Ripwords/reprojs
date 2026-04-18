import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalDiskAdapter } from "./local-disk"

let root: string
const roots: string[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ft-storage-"))
  roots.push(root)
})

afterAll(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))
})

describe("LocalDiskAdapter", () => {
  test("put writes bytes and returns the key", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/abc/screenshot.png"
    const bytes = new Uint8Array([137, 80, 78, 71])
    const result = await adapter.put(key, bytes, "image/png")
    expect(result.key).toBe(key)
  })

  test("get returns the bytes and content-type written by put", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/xyz/foo.png"
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await adapter.put(key, bytes, "image/png")
    const got = await adapter.get(key)
    expect(Array.from(got.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(got.contentType).toBe("image/png")
  })

  test("put creates parent directories", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("a/deeply/nested/key.bin", new Uint8Array([9]), "application/octet-stream")
    const got = await adapter.get("a/deeply/nested/key.bin")
    expect(got.bytes.length).toBe(1)
  })

  test("delete removes the file; deleting missing is not an error", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("x.bin", new Uint8Array([1]), "application/octet-stream")
    await adapter.delete("x.bin")
    await expect(adapter.get("x.bin")).rejects.toThrow()
    await adapter.delete("x.bin") // second delete no-op
  })
})
