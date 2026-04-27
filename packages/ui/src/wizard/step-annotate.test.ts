// packages/ui/src/wizard/step-annotate.test.ts
// Integration test: dispatch synthetic PointerEvents at the <canvas> rendered
// by <StepAnnotate> and assert that each of the 5 tools commits (or for text,
// does not commit immediately) the correct shape kind.
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { h, render } from "preact"
import { reset, shapes, tool } from "../annotation/store"
import { StepAnnotate } from "./step-annotate"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const { createCanvas } = await import("@napi-rs/canvas")

  const win = new Window()

  // Use the alternative strategy: keep happy-dom canvas elements (so dispatchEvent
  // works), but shim getContext to return a real @napi-rs/canvas context.
  // This avoids the "canvas.dispatchEvent is not a function" failure mode.
  ;(win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = function (
    this: { width: number; height: number },
    type: string,
  ) {
    const c = createCanvas(this.width || 1, this.height || 1)
    return c.getContext(type as "2d")
  }

  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLImageElement: win.HTMLImageElement,
    Image: win.Image,
    KeyboardEvent: win.KeyboardEvent,
    Event: win.Event,
    navigator: win.navigator,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0)
      return 0
    },
    cancelAnimationFrame: () => {},
  })
})

beforeEach(() => {
  reset()
  document.body.innerHTML = ""
})

function makeBg(): HTMLImageElement {
  const { createCanvas } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas")
  const c = createCanvas(400, 300)
  const ctx = c.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 400, 300)
  Object.defineProperty(c, "naturalWidth", { value: 400, configurable: true })
  Object.defineProperty(c, "naturalHeight", { value: 300, configurable: true })
  return c as unknown as HTMLImageElement
}

function mountStep(): HTMLElement {
  const host = document.createElement("div") as unknown as HTMLElement
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(host, "clientHeight", { value: 600, configurable: true })
  document.body.appendChild(host)
  render(
    h(StepAnnotate, {
      bg: makeBg(),
      steps: ["Annotate", "Details", "Review"],
      currentStep: 0,
      onSkip: () => {},
      onNext: () => {},
      onCancel: () => {},
    }),
    host,
  )
  return host
}

// Walk helpers at module scope (avoids lint consistent-function-scoping error)
function walkForTag(node: Element | HTMLElement, tag: string): Element | null {
  if ((node as Element).tagName?.toLowerCase() === tag) return node as Element
  const children = node.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child && (child as Element).tagName) {
      const found = walkForTag(child as Element, tag)
      if (found) return found
    }
  }
  return null
}

function findCanvas(host: HTMLElement): HTMLCanvasElement {
  // Walk children manually to avoid happy-dom querySelector SyntaxError issue
  // (querySelector's SyntaxError constructor lookup fails in the global override setup)
  const c = walkForTag(host, "canvas")
  if (!c) throw new Error("No <canvas> found in host")
  return c as unknown as HTMLCanvasElement
}

function findTextarea(host: HTMLElement): Element | null {
  return walkForTag(host, "textarea")
}

type PtrInit = { x: number; y: number; pressure?: number }

function firePointer(canvas: HTMLCanvasElement, type: string, p: PtrInit) {
  const e = new Event(type, { bubbles: true }) as Event & Record<string, unknown>
  Object.assign(e, {
    clientX: p.x,
    clientY: p.y,
    pointerId: 1,
    button: 0,
    pressure: p.pressure ?? 0.5,
  })
  canvas.dispatchEvent(e)
}

function drag(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  firePointer(canvas, "pointerdown", from)
  firePointer(canvas, "pointermove", to)
  firePointer(canvas, "pointerup", to)
}

describe("step-annotate pointer flows", () => {
  test("arrow tool: drag commits one arrow", async () => {
    const host = mountStep()
    const canvas = findCanvas(host)
    tool.value = "arrow"
    drag(canvas, { x: 100, y: 100 }, { x: 300, y: 200 })
    await new Promise((r) => setTimeout(r, 20))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value.at(0)?.kind).toBe("arrow")
  })

  test("rect tool: drag commits one rect", async () => {
    const host = mountStep()
    const canvas = findCanvas(host)
    tool.value = "rect"
    drag(canvas, { x: 100, y: 100 }, { x: 300, y: 300 })
    await new Promise((r) => setTimeout(r, 20))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value.at(0)?.kind).toBe("rect")
  })

  test("pen tool: drag commits one pen stroke", async () => {
    const host = mountStep()
    const canvas = findCanvas(host)
    tool.value = "pen"
    drag(canvas, { x: 100, y: 100 }, { x: 300, y: 200 })
    await new Promise((r) => setTimeout(r, 20))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value.at(0)?.kind).toBe("pen")
  })

  test("highlight tool: drag commits one highlight", async () => {
    const host = mountStep()
    const canvas = findCanvas(host)
    tool.value = "highlight"
    drag(canvas, { x: 100, y: 100 }, { x: 300, y: 200 })
    await new Promise((r) => setTimeout(r, 20))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value.at(0)?.kind).toBe("highlight")
  })

  test("text tool: drag opens a <textarea> and does not commit until blur", async () => {
    const host = mountStep()
    const canvas = findCanvas(host)
    tool.value = "text"
    drag(canvas, { x: 100, y: 100 }, { x: 300, y: 200 })
    await new Promise((r) => setTimeout(r, 20))
    expect(shapes.value).toHaveLength(0)
    const ta = findTextarea(host)
    expect(ta).not.toBeNull()
  })
})
