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

export function createInputObserver(opts: InputObserverOptions): { start(): void; stop(): void } {
  function handler(evt: Event): void {
    const target = evt.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
    if (!target) return
    const id = opts.mirror.getId(target)
    if (id === undefined) return
    const isChecked = "checked" in target ? Boolean((target as HTMLInputElement).checked) : false
    let text = "value" in target ? String(target.value ?? "") : ""
    if (opts.mask.shouldMaskInput(target)) text = opts.mask.maskValue(text)
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Input,
        id,
        text,
        isChecked,
        userTriggered: evt.isTrusted,
      },
      timestamp: opts.now(),
    })
  }

  return {
    start() {
      opts.doc.addEventListener("input", handler, { capture: true, passive: true })
      opts.doc.addEventListener("change", handler, { capture: true, passive: true })
    },
    stop() {
      opts.doc.removeEventListener("input", handler, { capture: true })
      opts.doc.removeEventListener("change", handler, { capture: true })
    },
  }
}
