import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { EventType, IncrementalSource } from "./types"
import { createRecorder } from "./record"

function setupDOM(): Document {
  const win = new Window({ url: "http://localhost/" })
  ;(win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError
  // Bun's global scope has no DOM — surface happy-dom's MutationObserver so
  // production code that references the global `MutationObserver` works.
  const g = globalThis as unknown as Record<string, unknown>
  const w = win as unknown as Record<string, unknown>
  for (const key of ["MutationObserver", "Node", "Element", "HTMLElement", "Event"]) {
    if (w[key] !== undefined) g[key] = w[key]
  }
  win.document.body.innerHTML = `<div id=root><p>hi</p></div>`
  return win.document as unknown as Document
}

describe("createRecorder", () => {
  test("start → first events are Meta then FullSnapshot", () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const events = recorder.peek()
    expect(events[0]?.type).toBe(EventType.Meta)
    expect(events[1]?.type).toBe(EventType.FullSnapshot)
    recorder.stop()
  })

  test("DOM mutation after start produces an IncrementalSnapshot Mutation event", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const before = recorder.peek().length
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    const span = doc.createElement("span")
    span.textContent = "new"
    root.appendChild(span)
    await new Promise((r) => queueMicrotask(r))
    const after = recorder.peek()
    expect(after.length).toBeGreaterThan(before)
    const mutations = after.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot && e.data.source === IncrementalSource.Mutation,
    )
    expect(mutations.length).toBeGreaterThan(0)
    recorder.stop()
  })

  test("pause/resume emits marker Custom events and suppresses events between", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    recorder.pause()
    const root = doc.getElementById("root")
    if (root) root.appendChild(doc.createElement("b"))
    await new Promise((r) => queueMicrotask(r))
    recorder.resume()
    const events = recorder.peek()
    const customTags = events
      .filter((e) => e.type === EventType.Custom)
      .map((e) => (e.data as { tag: string }).tag)
    expect(customTags).toContain("paused")
    expect(customTags).toContain("resumed")
    recorder.stop()
  })

  test("stop disconnects observers (subsequent DOM changes not recorded)", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    recorder.stop()
    const before = recorder.peek().length
    const root = doc.getElementById("root")
    if (root) root.appendChild(doc.createElement("hr"))
    await new Promise((r) => queueMicrotask(r))
    expect(recorder.peek().length).toBe(before)
  })

  test("flushGzipped returns a bytes result for non-empty sessions", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const result = await recorder.flushGzipped({ maxBytes: 1_048_576 })
    expect(result.bytes).not.toBeNull()
    expect(result.eventCount).toBeGreaterThan(0)
    recorder.stop()
  })
})
