// rrweb-compatible event shapes. We hand-write the subset we emit so the SDK
// doesn't depend on the rrweb runtime. The dashboard uses rrweb-player, which
// expects exactly these numeric tags and field names.

export const EventType = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

export const IncrementalSource = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
  // 7 (MediaInteraction), 9 (CanvasMutation), 10 (Font), 11 (Log) not emitted
  // by our subset — listed as comments against the rrweb schema.
  StyleSheetRule: 8,
  Drag: 12,
  AdoptedStyleSheet: 15,
} as const
export type IncrementalSource = (typeof IncrementalSource)[keyof typeof IncrementalSource]

/**
 * rrweb's `MouseInteractions` enum — rrweb-player keys its click-ripple and
 * touch-active animations off these numeric types. Value 8 is reserved by
 * rrweb as `TouchMove_Departed` (legacy) — do NOT emit it.
 */
export const MouseInteractions = {
  MouseUp: 0,
  MouseDown: 1,
  Click: 2,
  ContextMenu: 3,
  DblClick: 4,
  Focus: 5,
  Blur: 6,
  TouchStart: 7,
  // 8: TouchMove_Departed (legacy) — never emit
  TouchEnd: 9,
  TouchCancel: 10,
} as const
export type MouseInteractions = (typeof MouseInteractions)[keyof typeof MouseInteractions]

/** rrweb's `PointerTypes` enum. */
export const PointerTypes = {
  Mouse: 0,
  Pen: 1,
  Touch: 2,
} as const
export type PointerTypes = (typeof PointerTypes)[keyof typeof PointerTypes]

export const NodeType = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  Comment: 5,
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

export interface DocumentNode {
  type: typeof NodeType.Document
  id: number
  childNodes: SerializedNode[]
}

export interface DocumentTypeNode {
  type: typeof NodeType.DocumentType
  id: number
  name: string
  publicId: string
  systemId: string
}

export interface ElementNode {
  type: typeof NodeType.Element
  id: number
  tagName: string
  attributes: Record<string, string | number | boolean>
  childNodes: SerializedNode[]
  isSVG?: true
  needBlock?: true
}

export interface TextNode {
  type: typeof NodeType.Text
  id: number
  textContent: string
  isStyle?: true
}

export interface CommentNode {
  type: typeof NodeType.Comment
  id: number
  textContent: string
}

export type SerializedNode = DocumentNode | DocumentTypeNode | ElementNode | TextNode | CommentNode

export interface MetaEvent {
  type: typeof EventType.Meta
  data: { href: string; width: number; height: number }
  timestamp: number
}

export interface FullSnapshotEvent {
  type: typeof EventType.FullSnapshot
  data: { node: SerializedNode; initialOffset: { left: number; top: number } }
  timestamp: number
}

export interface MutationData {
  source: typeof IncrementalSource.Mutation
  adds: Array<{ parentId: number; nextId: number | null; node: SerializedNode }>
  removes: Array<{ parentId: number; id: number }>
  texts: Array<{ id: number; value: string }>
  attributes: Array<{ id: number; attributes: Record<string, string | null> }>
}

export interface MouseInteractionData {
  source: typeof IncrementalSource.MouseInteraction
  type: MouseInteractions
  id: number
  x: number
  y: number
  /** `PointerTypes.Mouse | Pen | Touch` when the browser exposes `pointerType`. */
  pointerType?: PointerTypes
}

export interface MousePosition {
  x: number
  y: number
  id: number
  /**
   * Negative offset in ms from the batch event's `timestamp` to when the
   * position was sampled. rrweb-player reconstructs the sample time as
   * `event.timestamp + position.timeOffset`.
   */
  timeOffset: number
}

export interface MouseMoveData {
  source:
    | typeof IncrementalSource.MouseMove
    | typeof IncrementalSource.TouchMove
    | typeof IncrementalSource.Drag
  positions: MousePosition[]
}

export interface ScrollData {
  source: typeof IncrementalSource.Scroll
  id: number
  x: number
  y: number
}

export interface ViewportResizeData {
  source: typeof IncrementalSource.ViewportResize
  width: number
  height: number
}

export interface InputData {
  source: typeof IncrementalSource.Input
  id: number
  text: string
  isChecked: boolean
  userTriggered?: boolean
}

export interface StyleSheetAddRule {
  rule: string
  index?: number | number[]
}

export interface StyleSheetDeleteRule {
  index: number | number[]
}

export interface StyleSheetRuleData {
  source: typeof IncrementalSource.StyleSheetRule
  /** Mirror id of the <style>/<link rel=stylesheet> element the sheet belongs to. */
  id?: number
  /** `styleId` used by rrweb for constructable stylesheets — unused by us. */
  styleId?: number
  /** Whole-text replace via `sheet.replace()` / `replaceSync()`. */
  replace?: string
  /** Individual rule insertions. */
  adds?: StyleSheetAddRule[]
  /** Individual rule deletions (by index). */
  removes?: StyleSheetDeleteRule[]
}

export interface AdoptedStyleSheetData {
  source: typeof IncrementalSource.AdoptedStyleSheet
  id: number
  /** Ordered list of styleIds adopted on this (shadow) root. */
  styleIds: number[]
  /** New sheets that appeared in this adoption — their initial rules. */
  styles?: Array<{ styleId: number; rules: StyleSheetAddRule[] }>
}

export type IncrementalData =
  | MutationData
  | MouseMoveData
  | MouseInteractionData
  | ScrollData
  | ViewportResizeData
  | InputData
  | StyleSheetRuleData
  | AdoptedStyleSheetData

export interface IncrementalSnapshotEvent {
  type: typeof EventType.IncrementalSnapshot
  data: IncrementalData
  timestamp: number
}

export interface CustomEvent {
  type: typeof EventType.Custom
  data: { tag: string; payload: Record<string, unknown> }
  timestamp: number
}

export type RecorderEvent = MetaEvent | FullSnapshotEvent | IncrementalSnapshotEvent | CustomEvent
