import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { serializeNodeWithChildren } from "../serialize"
import {
  EventType,
  IncrementalSource,
  type IncrementalSnapshotEvent,
  type MutationData,
} from "../types"

export interface MutationObserverHandle {
  start(): void
  stop(): void
}

export interface MutationObserverOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

function hasMaskedAncestor(el: Element | null): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.hasAttribute?.("data-feedback-mask")) return true
    cur = cur.parentElement
  }
  return false
}

export function createMutationObserver(opts: MutationObserverOptions): MutationObserverHandle {
  const observer = new MutationObserver((records) => flush(records))

  function flush(records: MutationRecord[]): void {
    const adds: MutationData["adds"] = []
    const removes: MutationData["removes"] = []
    const texts: MutationData["texts"] = []
    const attributes: MutationData["attributes"] = []

    for (const r of records) {
      if (r.type === "childList") {
        r.removedNodes.forEach((node) => {
          const id = opts.mirror.getId(node)
          const parentId = opts.mirror.getId(r.target)
          if (id !== undefined && parentId !== undefined) {
            removes.push({ parentId, id })
            opts.mirror.remove(node)
          }
        })
        r.addedNodes.forEach((node) => {
          if (opts.mask.shouldBlock(node as Element)) return
          const serialized = serializeNodeWithChildren(node, {
            mirror: opts.mirror,
            mask: opts.mask,
          })
          if (!serialized) return
          const parentId = opts.mirror.getOrCreateId(r.target)
          const next = node.nextSibling
          const nextId = next ? (opts.mirror.getId(next) ?? null) : null
          adds.push({ parentId, nextId, node: serialized })
        })
      } else if (r.type === "characterData") {
        const id = opts.mirror.getId(r.target)
        if (id === undefined) continue
        let value = r.target.nodeValue ?? ""
        const parent = r.target.parentElement
        if (parent && opts.mask.shouldBlock(parent)) value = ""
        else if (parent) {
          const tag = parent.tagName
          const shouldMask =
            tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
              ? opts.mask.shouldMaskInput(parent as HTMLInputElement)
              : hasMaskedAncestor(parent)
          if (shouldMask) value = opts.mask.maskValue(value)
        }
        texts.push({ id, value })
      } else if (r.type === "attributes") {
        const id = opts.mirror.getId(r.target)
        if (id === undefined) continue
        const name = r.attributeName
        if (!name) continue
        const el = r.target as Element
        let value: string | null = el.getAttribute(name)
        if (
          name === "value" &&
          (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") &&
          opts.mask.shouldMaskInput(el as HTMLInputElement) &&
          typeof value === "string"
        ) {
          value = opts.mask.maskValue(value)
        }
        attributes.push({ id, attributes: { [name]: value } })
      }
    }

    if (
      adds.length === 0 &&
      removes.length === 0 &&
      texts.length === 0 &&
      attributes.length === 0
    ) {
      return
    }

    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: { source: IncrementalSource.Mutation, adds, removes, texts, attributes },
      timestamp: opts.now(),
    })
  }

  return {
    start() {
      observer.observe(opts.doc, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeOldValue: false,
      })
    },
    stop() {
      observer.disconnect()
    },
  }
}
