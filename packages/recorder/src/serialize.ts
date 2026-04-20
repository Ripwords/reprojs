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

const URL_ATTRS_BY_TAG: Record<string, readonly string[]> = {
  a: ["href"],
  area: ["href"],
  link: ["href"],
  base: ["href"],
  img: ["src"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  iframe: ["src"],
  embed: ["src"],
  track: ["src"],
  object: ["data"],
  form: ["action"],
  use: ["href"],
}

const NON_RESOLVABLE_SCHEME = /^(javascript|data|blob|about|mailto|tel):/i

function absolutizeUrl(raw: string, baseURI: string): string {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith("#") || NON_RESOLVABLE_SCHEME.test(trimmed)) return raw
  try {
    return new URL(raw, baseURI).href
  } catch {
    return raw
  }
}

function absolutizeSrcset(raw: string, baseURI: string): string {
  return raw
    .split(",")
    .map((part) => {
      const entry = part.trim()
      if (!entry) return ""
      const space = entry.search(/\s/)
      if (space === -1) return absolutizeUrl(entry, baseURI)
      const url = entry.slice(0, space)
      const descriptor = entry.slice(space)
      return `${absolutizeUrl(url, baseURI)}${descriptor}`
    })
    .filter(Boolean)
    .join(", ")
}

function tryReadCssText(el: HTMLStyleElement | HTMLLinkElement): string | null {
  try {
    const sheet = el.sheet
    if (!sheet) return null
    const rules = sheet.cssRules
    if (!rules || rules.length === 0) return null
    let out = ""
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      if (rule) out += rule.cssText
    }
    return out || null
  } catch {
    // SecurityError on cross-origin stylesheets without CORS headers.
    return null
  }
}

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
  const baseURI = el.baseURI || el.ownerDocument?.baseURI || ""
  if (baseURI) {
    const urlAttrs = URL_ATTRS_BY_TAG[tagName]
    if (urlAttrs) {
      for (const attr of urlAttrs) {
        const v = attributes[attr]
        if (typeof v === "string") attributes[attr] = absolutizeUrl(v, baseURI)
      }
    }
    if (typeof attributes.srcset === "string") {
      attributes.srcset = absolutizeSrcset(attributes.srcset, baseURI)
    }
    if (typeof attributes["xlink:href"] === "string") {
      attributes["xlink:href"] = absolutizeUrl(attributes["xlink:href"] as string, baseURI)
    }
  }
  if (tagName === "style") {
    const cssText = tryReadCssText(el as HTMLStyleElement)
    if (cssText) attributes._cssText = cssText
  } else if (tagName === "link") {
    const rel = typeof attributes.rel === "string" ? attributes.rel.toLowerCase() : ""
    if (rel.includes("stylesheet")) {
      const cssText = tryReadCssText(el as HTMLLinkElement)
      if (cssText) attributes._cssText = cssText
    }
  }
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
