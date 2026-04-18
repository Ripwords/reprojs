import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createMask } from "./mask"
import { Mirror } from "./mirror"
import { NodeType, type ElementNode, type TextNode } from "./types"
import { serializeNodeWithChildren } from "./serialize"

function withDOM(html: string, fn: (doc: Document) => void): void {
  const win = new Window({ url: "http://localhost/" })
  // happy-dom 20.x needs SyntaxError installed on window for selector parsing.
  ;(win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError
  win.document.body.innerHTML = html
  fn(win.document as unknown as Document)
}

describe("serializeNodeWithChildren", () => {
  test("serializes a plain element with attributes + text child", () => {
    withDOM(`<div id=hello class=greeting>world</div>`, (doc) => {
      const el = doc.querySelector("#hello") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.type).toBe(NodeType.Element)
      expect(node.tagName).toBe("div")
      expect(node.attributes.id).toBe("hello")
      expect(node.attributes.class).toBe("greeting")
      expect(node.childNodes.length).toBe(1)
      const child = node.childNodes[0] as TextNode
      expect(child.type).toBe(NodeType.Text)
      expect(child.textContent).toBe("world")
    })
  })

  test("masks password input value attribute", () => {
    withDOM(`<input type=password value=secret123>`, (doc) => {
      const el = doc.querySelector("input") as HTMLInputElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.value).toBe("*".repeat("secret123".length))
      expect(node.attributes.type).toBe("password")
    })
  })

  test("returns null for data-feedback-block subtree root", () => {
    withDOM(`<div data-feedback-block><span>secret</span></div>`, (doc) => {
      const el = doc.querySelector("div") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      })
      expect(node).toBeNull()
    })
  })

  test("skips <script> and <noscript> children entirely", () => {
    withDOM(`<div><script>alert(1)</script><p>ok</p></div>`, (doc) => {
      const el = doc.querySelector("div") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      const childTags = (
        node.childNodes.filter((c) => c.type === NodeType.Element) as ElementNode[]
      ).map((c) => c.tagName)
      expect(childTags).toEqual(["p"])
    })
  })
})
