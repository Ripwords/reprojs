import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface InputObserverOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

type InputTarget = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

interface LastEmission {
  text: string
  isChecked: boolean
}

/**
 * Per-node dedup cache — rrweb skips emitting if the observed text/isChecked
 * pair matches the last one emitted for the same node. This matters a LOT
 * during IME composition (each composition event re-fires `input`) and for
 * controlled React components where identical state updates can re-assign
 * `.value` multiple times per render.
 */
function shouldDedup(prev: LastEmission | undefined, next: LastEmission): boolean {
  if (!prev) return false
  return prev.text === next.text && prev.isChecked === next.isChecked
}

export function createInputObserver(opts: InputObserverOptions): { start(): void; stop(): void } {
  const lastByNode = new WeakMap<InputTarget, LastEmission>()
  const patchedSetters: Array<() => void> = []

  function captureAndEmit(target: InputTarget, userTriggered: boolean): void {
    const id = opts.mirror.getId(target)
    if (id === undefined) return
    const isChecked = "checked" in target ? Boolean((target as HTMLInputElement).checked) : false
    let text = "value" in target ? String(target.value ?? "") : ""
    if (opts.mask.shouldMaskInput(target)) text = opts.mask.maskValue(text)

    const next: LastEmission = { text, isChecked }
    if (shouldDedup(lastByNode.get(target), next)) return
    lastByNode.set(target, next)

    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Input,
        id,
        text,
        isChecked,
        userTriggered,
      },
      timestamp: opts.now(),
    })
  }

  function handleEvent(evt: Event): void {
    const target = evt.target as InputTarget | null
    if (!target) return
    captureAndEmit(target, evt.isTrusted === true)
  }

  /**
   * Hook the native setter for a property so programmatic assignments — not
   * just user-driven `input` events — are captured. React's controlled
   * components set `.value` directly on the DOM element without firing a
   * synthetic `input`, so without this hook those changes are invisible to
   * the replay. rrweb does the same: see `initInputObserver` in
   * `rrweb/src/record/observer.ts` (`hookSetter` at around line 497).
   *
   * We keep the patch opt-in-per-prototype to avoid double-patching when
   * multiple recorders are instantiated, and return a restore function so
   * stop() can undo it.
   */
  function hookSetter<T extends object>(proto: T, key: "value" | "checked"): () => void {
    const desc = Object.getOwnPropertyDescriptor(proto, key)
    if (!desc || typeof desc.set !== "function") return () => {}
    const originalSet = desc.set
    const originalGet = desc.get
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: desc.enumerable ?? true,
      get: originalGet,
      set(this: InputTarget, value: unknown) {
        // Always let the native setter run first so the DOM reflects the
        // new state by the time we capture.
        originalSet.call(this, value)
        // Programmatic assignment is, by definition, not `isTrusted`.
        captureAndEmit(this, false)
      },
    })
    return () => {
      Object.defineProperty(proto, key, desc)
    }
  }

  return {
    start() {
      opts.doc.addEventListener("input", handleEvent, { capture: true, passive: true })
      opts.doc.addEventListener("change", handleEvent, { capture: true, passive: true })
      // Prototype-level hooks. Wrapped in try/catch because some SSR'd /
      // jsdom-style environments treat these descriptors as non-
      // configurable, and we'd rather lose programmatic-change tracking
      // than break the whole recorder.
      const win = opts.doc.defaultView as (Window & typeof globalThis) | null
      if (!win) return
      try {
        patchedSetters.push(hookSetter(win.HTMLInputElement.prototype, "value"))
        patchedSetters.push(hookSetter(win.HTMLInputElement.prototype, "checked"))
        patchedSetters.push(hookSetter(win.HTMLTextAreaElement.prototype, "value"))
        patchedSetters.push(hookSetter(win.HTMLSelectElement.prototype, "value"))
      } catch {
        /* descriptor not configurable — skip */
      }
    },
    stop() {
      opts.doc.removeEventListener("input", handleEvent, { capture: true })
      opts.doc.removeEventListener("change", handleEvent, { capture: true })
      for (const restore of patchedSetters) {
        try {
          restore()
        } catch {
          /* best-effort */
        }
      }
      patchedSetters.length = 0
    },
  }
}
