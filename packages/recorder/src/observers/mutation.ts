import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { serializeNodeWithChildren } from "../serialize"
import {
  EventType,
  IncrementalSource,
  type IncrementalSnapshotEvent,
  type MutationData,
  type SerializedNode,
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

function isAncestor(ancestor: Node, candidate: Node): boolean {
  let cur: Node | null = candidate.parentNode
  while (cur) {
    if (cur === ancestor) return true
    cur = cur.parentNode
  }
  return false
}

/**
 * Mutation observer, structured after rrweb's `MutationBuffer` (packages/
 * rrweb/src/record/mutation.ts). The naive "iterate MutationRecords in
 * order" approach loses information in several browser-batched cases that
 * are common on React re-renders:
 *
 *   1. A node added then removed in the same microtask — we must emit
 *      neither an `add` nor a `remove` (the node never existed from the
 *      player's perspective), and we must NOT serialize it (its subtree
 *      may already be detached from `document`, so a walk can hit stale
 *      references or throw).
 *
 *   2. A subtree removal — when `<div>` with 50 children is unmounted, the
 *      browser may deliver one MutationRecord for the <div> and 50 for the
 *      children (or none — browsers differ). We must emit exactly ONE
 *      `remove` for the root of the subtree and drop the descendants.
 *
 *   3. Out-of-order adds — when `<A><B/></A>` is appended to the DOM, the
 *      browser may deliver `[B-added, A-added]` or `[A-added, B-added]`
 *      depending on the order mutations were observed. rrweb-player rebuilds
 *      by applying adds in emit order; if B lands before A, the player has
 *      no element with A's id to attach B to and the subtree renders
 *      partially. We must sort adds so ancestors come before descendants.
 *
 *   4. Text/attribute updates on nodes that are ALSO being removed this
 *      batch — redundant. The remove supersedes them.
 */
export function createMutationObserver(opts: MutationObserverOptions): MutationObserverHandle {
  const observer = new MutationObserver((records) => flush(records))

  function flush(records: MutationRecord[]): void {
    // Addition candidates keyed by node to dedupe if the same node appears
    // in multiple records (happens on React StrictMode double-invocation
    // and on nested fragment splices).
    const addedSet = new Set<Node>()
    const removedSet = new Set<Node>()
    // Roots of removed subtrees — we emit remove only for these.
    const removedSubtreeRoots = new Set<Node>()
    // Keyed maps for text / attribute updates so we emit each target once
    // with the latest value (rrweb does the same).
    const textUpdates = new Map<Node, string>()
    const attrUpdates = new Map<Element, Map<string, string | null>>()

    for (const r of records) {
      if (r.type === "childList") {
        r.removedNodes.forEach((node) => {
          if (addedSet.has(node)) {
            // Added and removed in the same batch — drop entirely.
            addedSet.delete(node)
            return
          }
          removedSet.add(node)
        })
        r.addedNodes.forEach((node) => {
          if (removedSet.has(node)) {
            // Moved: treat as add (rrweb removes from the remove set).
            removedSet.delete(node)
          }
          addedSet.add(node)
        })
      } else if (r.type === "characterData") {
        textUpdates.set(r.target, r.target.nodeValue ?? "")
      } else if (r.type === "attributes") {
        if (!r.attributeName) continue
        const el = r.target as Element
        const existing = attrUpdates.get(el) ?? new Map<string, string | null>()
        existing.set(r.attributeName, el.getAttribute(r.attributeName))
        attrUpdates.set(el, existing)
      }
    }

    // Collapse removed subtrees: if a removed node has a removed ancestor,
    // drop it — only the outermost removal matters for replay.
    const removedList = Array.from(removedSet)
    for (const node of removedList) {
      let hasRemovedAncestor = false
      for (const other of removedList) {
        if (other !== node && isAncestor(other, node)) {
          hasRemovedAncestor = true
          break
        }
      }
      if (!hasRemovedAncestor) removedSubtreeRoots.add(node)
    }

    // Build the removes payload; record the parent id BEFORE we drop the
    // node from the mirror.
    const removes: MutationData["removes"] = []
    for (const node of removedSubtreeRoots) {
      const id = opts.mirror.getId(node)
      if (id === undefined) continue
      // r.target was the parent at the time of the mutation — but by the
      // time we run, the node is already detached. Fall back to
      // `node.parentNode` if available (happens on some batched removes);
      // otherwise skip, since the player doesn't need parentId to process
      // a remove of a known id.
      const parent = node.parentNode
      const parentId = parent ? opts.mirror.getId(parent) : undefined
      removes.push(parentId !== undefined ? { parentId, id } : { parentId: -1, id })
      // Recursively drop the subtree from the mirror so stale IDs don't
      // confuse future batches.
      const walk = (n: Node) => {
        opts.mirror.remove(n)
        n.childNodes.forEach(walk)
      }
      walk(node)
    }

    // Sort added nodes so ancestors come before descendants. Otherwise the
    // replay player hits an "unknown parentId" when it tries to attach a
    // child before its parent has been materialised.
    const addedList = Array.from(addedSet).filter((node) => {
      // Only add nodes still attached to document — a node added then
      // detached without a matching remove record (rare but observed) is
      // effectively gone.
      return opts.doc.contains(node)
    })
    addedList.sort((a, b) => {
      if (isAncestor(a, b)) return -1
      if (isAncestor(b, a)) return 1
      return 0
    })

    const adds: MutationData["adds"] = []
    for (const node of addedList) {
      if (opts.mask.shouldBlock(node as Element)) continue
      const parent = node.parentNode
      if (!parent) continue
      const parentId = opts.mirror.getOrCreateId(parent)
      const serialized = serializeNodeWithChildren(node, {
        mirror: opts.mirror,
        mask: opts.mask,
      }) as SerializedNode | null
      if (!serialized) continue
      const nextId = node.nextSibling ? (opts.mirror.getId(node.nextSibling) ?? null) : null
      adds.push({ parentId, nextId, node: serialized })
    }

    // Texts: only emit for nodes that still have a Mirror id (not removed
    // this batch).
    const texts: MutationData["texts"] = []
    for (const [target, rawValue] of textUpdates) {
      const id = opts.mirror.getId(target)
      if (id === undefined) continue
      let value = rawValue
      const parent = target.parentElement
      if (parent && opts.mask.shouldBlock(parent)) {
        value = ""
      } else if (parent) {
        const tag = parent.tagName
        const shouldMask =
          tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
            ? opts.mask.shouldMaskInput(parent as HTMLInputElement)
            : hasMaskedAncestor(parent)
        if (shouldMask) value = opts.mask.maskValue(value)
      }
      texts.push({ id, value })
    }

    // Attributes: same story — skip nodes no longer in the mirror.
    const attributes: MutationData["attributes"] = []
    for (const [el, updates] of attrUpdates) {
      const id = opts.mirror.getId(el)
      if (id === undefined) continue
      const attrs: Record<string, string | null> = {}
      for (const [name, rawValue] of updates) {
        let value = rawValue
        if (
          name === "value" &&
          (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") &&
          opts.mask.shouldMaskInput(el as HTMLInputElement) &&
          typeof value === "string"
        ) {
          value = opts.mask.maskValue(value)
        }
        attrs[name] = value
      }
      attributes.push({ id, attributes: attrs })
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
