import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { serializeNodeWithChildren } from "../serialize"
import { EventType, type FullSnapshotEvent, type MetaEvent } from "../types"

export interface FullSnapshotOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  now: () => number
}

/**
 * Emits a Meta event (URL + viewport) immediately followed by a FullSnapshot
 * event (serialized document tree with node IDs). Call once at recorder start
 * and optionally on major navigations.
 */
export function emitFullSnapshot(opts: FullSnapshotOptions): [MetaEvent, FullSnapshotEvent] {
  const meta: MetaEvent = {
    type: EventType.Meta,
    data: {
      href: opts.doc.location.href,
      width: opts.doc.defaultView?.innerWidth ?? 0,
      height: opts.doc.defaultView?.innerHeight ?? 0,
    },
    timestamp: opts.now(),
  }
  const node = serializeNodeWithChildren(opts.doc, { mirror: opts.mirror, mask: opts.mask })
  if (!node) throw new Error("full-snapshot: document serialization returned null")
  const full: FullSnapshotEvent = {
    type: EventType.FullSnapshot,
    data: {
      node,
      initialOffset: {
        left: opts.doc.defaultView?.scrollX ?? 0,
        top: opts.doc.defaultView?.scrollY ?? 0,
      },
    },
    timestamp: opts.now(),
  }
  return [meta, full]
}
