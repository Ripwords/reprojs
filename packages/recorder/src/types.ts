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
  // MouseMove: 1 — reserved by rrweb schema; not emitted by our minimal observer subset.
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
} as const
export type IncrementalSource = (typeof IncrementalSource)[keyof typeof IncrementalSource]

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
  type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  id: number
  x: number
  y: number
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

export type IncrementalData =
  | MutationData
  | MouseInteractionData
  | ScrollData
  | ViewportResizeData
  | InputData

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
