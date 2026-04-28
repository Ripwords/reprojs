import { expect, test } from "bun:test"
import { DEFAULT_ATTACHMENT_LIMITS, validateAttachments, type Attachment } from "./index"

function makeFile(name: string, bytes: number, type = "image/png"): File {
  const blob = new Blob([new Uint8Array(bytes)], { type })
  return new File([blob], name, { type })
}

function makeExisting(size: number, mime = "image/png"): Attachment {
  return {
    id: "x",
    blob: new Blob([new Uint8Array(size)], { type: mime }),
    filename: "existing.png",
    mime,
    size,
    isImage: mime.startsWith("image/"),
  }
}

test("accepts a single small image", () => {
  const result = validateAttachments([makeFile("a.png", 100)], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.rejected).toHaveLength(0)
  expect(result.accepted[0]?.isImage).toBe(true)
})

test("rejects a file over per-file cap", () => {
  const big = makeFile("big.png", DEFAULT_ATTACHMENT_LIMITS.maxFileBytes + 1)
  const result = validateAttachments([big], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "big.png", reason: "too-large" }])
})

test("rejects when count would exceed maxCount", () => {
  const existing = Array.from({ length: 5 }, () => makeExisting(10))
  const result = validateAttachments([makeFile("new.png", 10)], existing, DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "new.png", reason: "count-exceeded" }])
})

test("rejects when total bytes would exceed maxTotalBytes", () => {
  const existing = [makeExisting(20 * 1024 * 1024)]
  const result = validateAttachments(
    [makeFile("a.png", 10 * 1024 * 1024)],
    existing,
    DEFAULT_ATTACHMENT_LIMITS,
  )
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "a.png", reason: "total-exceeded" }])
})

test("rejects denylisted mime", () => {
  const exe = makeFile("evil.exe", 100, "application/x-msdownload")
  const result = validateAttachments([exe], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "evil.exe", reason: "denied-mime" }])
})

test("rejects denylisted extension even if mime is benign", () => {
  const fake = makeFile("script.sh", 100, "text/plain")
  const result = validateAttachments([fake], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "script.sh", reason: "denied-mime" }])
})

test("accumulates errors instead of bailing on first", () => {
  const ok = makeFile("ok.png", 100)
  const big = makeFile("big.png", DEFAULT_ATTACHMENT_LIMITS.maxFileBytes + 1)
  const evil = makeFile("evil.exe", 100, "application/x-msdownload")
  const result = validateAttachments([ok, big, evil], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.accepted[0]?.filename).toBe("ok.png")
  expect(result.rejected).toEqual([
    { filename: "big.png", reason: "too-large" },
    { filename: "evil.exe", reason: "denied-mime" },
  ])
})

test("count check considers files added earlier in the same batch", () => {
  const existing = [makeExisting(10), makeExisting(10), makeExisting(10), makeExisting(10)]
  const a = makeFile("a.png", 10)
  const b = makeFile("b.png", 10)
  const result = validateAttachments([a, b], existing, DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.rejected).toEqual([{ filename: "b.png", reason: "count-exceeded" }])
})

test("zero-byte file is rejected as unreadable", () => {
  const empty = makeFile("empty.png", 0)
  const result = validateAttachments([empty], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "empty.png", reason: "unreadable" }])
})

test("missing mime defaults to application/octet-stream", () => {
  const blob = new Blob([new Uint8Array(100)])
  const file = new File([blob], "data.bin")
  const result = validateAttachments([file], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted[0]?.mime).toBe("application/octet-stream")
})
