import type { Mask } from "./mask"
import type { Mirror } from "./mirror"
import {
  NodeType,
  type ElementNode,
  type SerializedNode,
  type TextNode,
  type CommentNode,
  type DocumentNode,
  type DocumentTypeNode,
} from "./types"

export interface SerializeContext {
  mirror: Mirror
  mask: Mask
}

const SKIP_TAGS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE"])

export function serializeNodeWithChildren(
  node: Node,
  ctx: SerializeContext,
): SerializedNode | null {
  if (node.nodeType === 1) {
    const el = node as Element
    if (SKIP_TAGS.has(el.tagName)) return null
    if (ctx.mask.shouldBlock(el)) return null
    return serializeElement(el, ctx)
  }
  if (node.nodeType === 3) {
    return serializeText(node as Text, ctx)
  }
  if (node.nodeType === 8) {
    const id = ctx.mirror.getOrCreateId(node)
    const c: CommentNode = { type: NodeType.Comment, id, textContent: node.nodeValue ?? "" }
    return c
  }
  if (node.nodeType === 9) {
    const id = ctx.mirror.getOrCreateId(node)
    const children: SerializedNode[] = []
    node.childNodes.forEach((child) => {
      const s = serializeNodeWithChildren(child, ctx)
      if (s) children.push(s)
    })
    const d: DocumentNode = { type: NodeType.Document, id, childNodes: children }
    return d
  }
  if (node.nodeType === 10) {
    const id = ctx.mirror.getOrCreateId(node)
    const dt = node as DocumentType
    const n: DocumentTypeNode = {
      type: NodeType.DocumentType,
      id,
      name: dt.name,
      publicId: dt.publicId,
      systemId: dt.systemId,
    }
    return n
  }
  return null
}

function serializeElement(el: Element, ctx: SerializeContext): ElementNode {
  const id = ctx.mirror.getOrCreateId(el)
  const attributes: Record<string, string | number | boolean> = {}
  for (const attr of Array.from(el.attributes)) {
    attributes[attr.name] = attr.value
  }
  const tagName = el.tagName.toLowerCase()
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    // Prefer the live DOM value over the HTML attribute (which reflects only
    // `defaultValue`). Ensures pre-typed content captures correctly in the
    // initial full-snapshot while still being mask-checked below.
    const liveValue = (el as HTMLInputElement).value
    if (typeof liveValue === "string") {
      attributes.value = liveValue
    }
    if (ctx.mask.shouldMaskInput(el as HTMLInputElement)) {
      if (typeof attributes.value === "string") {
        attributes.value = ctx.mask.maskValue(attributes.value)
      }
    }
  }
  const children: SerializedNode[] = []
  el.childNodes.forEach((child) => {
    const s = serializeNodeWithChildren(child, ctx)
    if (s) children.push(s)
  })
  const isSVG = tagName === "svg" || el.namespaceURI === "http://www.w3.org/2000/svg"
  const out: ElementNode = { type: NodeType.Element, id, tagName, attributes, childNodes: children }
  if (isSVG) out.isSVG = true
  return out
}

function serializeText(text: Text, ctx: SerializeContext): TextNode {
  const id = ctx.mirror.getOrCreateId(text)
  const parent = text.parentElement
  const isStyleTag = parent?.tagName === "STYLE"
  let value = text.nodeValue ?? ""
  if (parent && ctx.mask.shouldBlock(parent)) return { type: NodeType.Text, id, textContent: "" }
  if (parent && hasMaskedAncestor(parent)) {
    value = ctx.mask.maskValue(value)
  }
  const out: TextNode = { type: NodeType.Text, id, textContent: value }
  if (isStyleTag) out.isStyle = true
  return out
}

function hasMaskedAncestor(el: Element | null): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.hasAttribute?.("data-feedback-mask")) return true
    cur = cur.parentElement
  }
  return false
}
