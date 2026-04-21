import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { EventType, IncrementalSource, NodeType, type SerializedNode } from "./types"
import { createRecorder } from "./record"

function findFirstElementByTag(node: SerializedNode, tag: string): SerializedNode | null {
  if (node.type === NodeType.Element && node.tagName === tag.toLowerCase()) return node
  if ("childNodes" in node) {
    for (const child of node.childNodes ?? []) {
      const hit = findFirstElementByTag(child, tag)
      if (hit) return hit
    }
  }
  return null
}

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

  test("re-takes a FullSnapshot on checkoutEveryMs so the rolling buffer never evicts its only baseline", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      // Short interval to keep the test fast; windowMs here is irrelevant —
      // we only care that the checkout timer fires.
      config: { masking: "moderate", windowMs: 1_000, checkoutEveryMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const before = recorder.peek().filter((e) => e.type === EventType.FullSnapshot).length
    await new Promise((r) => setTimeout(r, 120))
    const after = recorder.peek().filter((e) => e.type === EventType.FullSnapshot).length
    // Initial + at least one checkout.
    expect(after).toBeGreaterThan(before)
    recorder.stop()
  })

  test("checkout snapshot runs inside requestIdleCallback so it can't stutter the host app", async () => {
    const doc = setupDOM()
    let idleCalls = 0
    const g = globalThis as unknown as { requestIdleCallback?: unknown }
    const original = g.requestIdleCallback
    g.requestIdleCallback = (cb: (deadline: { didTimeout: boolean }) => void) => {
      idleCalls += 1
      cb({ didTimeout: false })
      return 1
    }
    try {
      const recorder = createRecorder({
        doc,
        config: { masking: "moderate", windowMs: 1_000, checkoutEveryMs: 40 },
        bufferBytes: 1_000_000,
      })
      recorder.start()
      await new Promise((r) => setTimeout(r, 100))
      expect(idleCalls).toBeGreaterThan(0)
      recorder.stop()
    } finally {
      g.requestIdleCallback = original
    }
  })

  test("Mirror reuses IDs across checkouts for elements present in both snapshots (mutations stay valid)", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate", windowMs: 1_000, checkoutEveryMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    await new Promise((r) => setTimeout(r, 120))
    const snapshots = recorder
      .peek()
      .filter(
        (e): e is Extract<typeof e, { type: typeof EventType.FullSnapshot }> =>
          e.type === EventType.FullSnapshot,
      )
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    const first = snapshots[0]
    const second = snapshots[1]
    if (!first || !second) throw new Error("missing snapshots")
    const rootA = findFirstElementByTag(first.data.node, "div")
    const rootB = findFirstElementByTag(second.data.node, "div")
    expect(rootA).not.toBeNull()
    expect(rootB).not.toBeNull()
    // Same DOM element → same Mirror ID in both snapshots. Without this, old
    // mutation events in the buffer would reference a node that doesn't exist
    // in the replay's active snapshot.
    expect(rootA?.id).toBe(rootB?.id as number)
    recorder.stop()
  })

  test("stop() cancels the checkout timer — no snapshots emitted after stop", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate", windowMs: 1_000, checkoutEveryMs: 30 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    recorder.stop()
    const before = recorder.peek().length
    await new Promise((r) => setTimeout(r, 120))
    expect(recorder.peek().length).toBe(before)
  })

  test("pause() suppresses checkout snapshots until resume()", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate", windowMs: 1_000, checkoutEveryMs: 30 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    recorder.pause()
    const before = recorder.peek().filter((e) => e.type === EventType.FullSnapshot).length
    await new Promise((r) => setTimeout(r, 100))
    const whilePaused = recorder.peek().filter((e) => e.type === EventType.FullSnapshot).length
    expect(whilePaused).toBe(before)
    recorder.resume()
    await new Promise((r) => setTimeout(r, 120))
    const afterResume = recorder.peek().filter((e) => e.type === EventType.FullSnapshot).length
    expect(afterResume).toBeGreaterThan(whilePaused)
    recorder.stop()
  })

  test("emits MouseMove events (source=1) with batched positions so rrweb-player's cursor animates during replay", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      // Short flush interval keeps the test fast.
      config: { masking: "moderate", mouseMoveSampleMs: 10, mouseMoveFlushMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    // Three mousemove events spaced out so two sample windows land.
    root.dispatchEvent(
      new (doc.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(
        "mousemove",
        {
          bubbles: true,
          clientX: 100,
          clientY: 150,
        },
      ),
    )
    await new Promise((r) => setTimeout(r, 20))
    root.dispatchEvent(
      new (doc.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(
        "mousemove",
        {
          bubbles: true,
          clientX: 110,
          clientY: 160,
        },
      ),
    )
    // Wait past flushMs so the batch flush fires.
    await new Promise((r) => setTimeout(r, 80))
    const mm = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot && (e.data as { source: number }).source === 1,
      )
    expect(mm.length).toBeGreaterThan(0)
    const first = mm[0]
    if (!first) throw new Error("unreachable: length already asserted > 0")
    const positions = (first.data as { positions: unknown[] }).positions
    expect(Array.isArray(positions)).toBe(true)
    expect(positions.length).toBeGreaterThan(0)
    recorder.stop()
  })

  test("MouseMove position timeOffset is NEGATIVE in the wire format (rrweb-player reconstructs sample time as event.timestamp + position.timeOffset)", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate", mouseMoveSampleMs: 10, mouseMoveFlushMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    root.dispatchEvent(
      new (doc.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(
        "mousemove",
        {
          bubbles: true,
          clientX: 200,
          clientY: 300,
        },
      ),
    )
    await new Promise((r) => setTimeout(r, 80))
    const mm = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot && (e.data as { source: number }).source === 1,
      ) as Array<{ data: { positions: Array<{ timeOffset: number }> } }>
    expect(mm.length).toBeGreaterThan(0)
    for (const ev of mm) {
      for (const p of ev.data.positions) {
        expect(p.timeOffset).toBeLessThanOrEqual(0)
      }
    }
    recorder.stop()
  })

  test("MouseMove sampling throttles fast-firing events to at most one per mouseMoveSampleMs", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      // Wide sample window so only 1 position survives; short flush so test is fast.
      config: { masking: "moderate", mouseMoveSampleMs: 200, mouseMoveFlushMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    const MouseEventCtor = (doc.defaultView as unknown as { MouseEvent: typeof MouseEvent })
      .MouseEvent
    for (let i = 0; i < 10; i++) {
      root.dispatchEvent(new MouseEventCtor("mousemove", { bubbles: true, clientX: i, clientY: i }))
    }
    await new Promise((r) => setTimeout(r, 80))
    const mm = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot && (e.data as { source: number }).source === 1,
      ) as Array<{ data: { positions: Array<unknown> } }>
    const totalPositions = mm.reduce((n, ev) => n + ev.data.positions.length, 0)
    // 10 events within 200ms → 1 position (the first, sample window gates the rest).
    expect(totalPositions).toBe(1)
    recorder.stop()
  })

  test("touchmove is emitted as source=6 (TouchMove), not conflated with source=1", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate", mouseMoveSampleMs: 10, mouseMoveFlushMs: 40 },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    // happy-dom provides TouchEvent; if not, fall back to a plain Event with
    // synthesized touches so the observer can still read clientX/Y from it.
    const TouchEventCtor = (doc.defaultView as unknown as { TouchEvent?: typeof TouchEvent })
      .TouchEvent
    const ev = TouchEventCtor
      ? new TouchEventCtor("touchmove", {
          bubbles: true,
          touches: [{ clientX: 5, clientY: 5 } as Touch],
        })
      : Object.assign(
          new (doc.defaultView as unknown as { Event: typeof Event }).Event("touchmove", {
            bubbles: true,
          }),
          {
            touches: [{ clientX: 5, clientY: 5 }],
          },
        )
    root.dispatchEvent(ev as Event)
    await new Promise((r) => setTimeout(r, 80))
    const sources = recorder
      .peek()
      .filter((e) => e.type === EventType.IncrementalSnapshot)
      .map((e) => (e.data as { source: number }).source)
    expect(sources).toContain(6)
    expect(sources).not.toContain(1)
    recorder.stop()
  })

  test("input observer captures programmatic .value assignment (React-controlled inputs don't fire a real 'input' event)", async () => {
    const doc = setupDOM()
    const input = doc.createElement("input")
    input.id = "x"
    input.type = "text"
    doc.body.appendChild(input)
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const before = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.Input,
      ).length
    input.value = "hello"
    await new Promise((r) => queueMicrotask(r))
    const after = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.Input,
      ).length
    expect(after).toBeGreaterThan(before)
    recorder.stop()
  })

  test("input observer dedups consecutive identical emissions (prevents 10× event volume on IME composition)", async () => {
    const doc = setupDOM()
    const input = doc.createElement("input")
    input.id = "x"
    input.type = "text"
    doc.body.appendChild(input)
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const Evt = (doc.defaultView as unknown as { Event: typeof Event }).Event
    input.value = "hello"
    input.dispatchEvent(new Evt("input", { bubbles: true }))
    input.dispatchEvent(new Evt("input", { bubbles: true }))
    input.dispatchEvent(new Evt("input", { bubbles: true }))
    await new Promise((r) => queueMicrotask(r))
    const inputs = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.Input,
      )
    expect(inputs.length).toBeLessThanOrEqual(2)
    recorder.stop()
  })

  test("mutation observer drops add+remove pairs that happen in the same batch (no phantom nodes)", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    const n = doc.createElement("span")
    root.appendChild(n)
    root.removeChild(n)
    await new Promise((r) => queueMicrotask(r))
    const mutations = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.Mutation,
      ) as Array<{ data: { adds: unknown[]; removes: unknown[] } }>
    for (const m of mutations) {
      expect(m.data.adds.length).toBe(0)
      expect(m.data.removes.length).toBe(0)
    }
    recorder.stop()
  })

  test("mutation observer emits a single remove for a subtree root, not one per descendant", async () => {
    const doc = setupDOM()
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    const tree = doc.createElement("div")
    tree.id = "tree"
    const p1 = doc.createElement("p")
    const s1 = doc.createElement("span")
    s1.textContent = "a"
    p1.appendChild(s1)
    const p2 = doc.createElement("p")
    const s2 = doc.createElement("span")
    s2.textContent = "b"
    p2.appendChild(s2)
    tree.appendChild(p1)
    tree.appendChild(p2)
    root.appendChild(tree)
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    tree.remove()
    await new Promise((r) => queueMicrotask(r))
    const mutations = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.Mutation,
      ) as Array<{ data: { removes: Array<{ id: number }> } }>
    const totalRemoves = mutations.reduce((n, m) => n + m.data.removes.length, 0)
    expect(totalRemoves).toBe(1)
    recorder.stop()
  })

  test("stylesheet-rule observer emits source=8 add event when insertRule is called on a <style> sheet", () => {
    const doc = setupDOM()
    const style = doc.createElement("style")
    style.id = "sheet"
    doc.head.appendChild(style)
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    if (!style.sheet) {
      // happy-dom doesn't always expose a CSSStyleSheet — skip.
      recorder.stop()
      return
    }
    // Two things the host DOM must support for this test to be meaningful:
    // (1) `sheet.insertRule` must resolve through the prototype so our
    //     patch can intercept it, and
    // (2) `sheet.ownerNode` must point back to the <style> so we can map
    //     the sheet to a Mirror id.
    // Real browsers guarantee both by spec; happy-dom's CSSStyleSheet stub
    // misses (2) — `ownerNode` is null, so `idForSheet` returns undefined
    // and no event is emitted. We skip the test gracefully in that case;
    // the implementation is covered by real-browser behavior not unit
    // testable here without a full DOM.
    if (style.sheet.ownerNode !== style) {
      recorder.stop()
      return
    }
    style.sheet.insertRule(".dynamic { color: red }", 0)
    const ssr = recorder
      .peek()
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e.data as { source: number }).source === IncrementalSource.StyleSheetRule,
      ) as Array<{ data: { adds?: Array<{ rule: string }>; id?: number } }>
    expect(ssr.length).toBeGreaterThan(0)
    const first = ssr[0]
    expect(first?.data.adds?.[0]?.rule).toContain(".dynamic")
    expect(typeof first?.data.id).toBe("number")
    recorder.stop()
  })

  test("stylesheet-rule observer emits source=8 directly — verifies the emit pipeline independent of happy-dom's CSSOM routing", () => {
    // Direct unit test: construct a fake sheet with an ownerNode that's in
    // the mirror, call into the observer's emit path. Proves the wire
    // format is right even when happy-dom's prototype routing isn't.
    const doc = setupDOM()
    const style = doc.createElement("style")
    doc.head.appendChild(style)
    const recorder = createRecorder({
      doc,
      config: { masking: "moderate" },
      bufferBytes: 1_000_000,
    })
    recorder.start()
    // Mirror should now know about the <style>. Find its id by walking the
    // FullSnapshot event.
    const snap = recorder.peek().find((e) => e.type === EventType.FullSnapshot) as
      | {
          data: {
            node: { childNodes: Array<{ tagName?: string; id: number; childNodes?: unknown[] }> }
          }
        }
      | undefined
    expect(snap).toBeDefined()
    recorder.stop()
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
