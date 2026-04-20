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

  test("extracts cssText from <style> sheet into _cssText attribute", () => {
    withDOM(`<style>.foo { color: red; }</style>`, (doc) => {
      const el = doc.querySelector("style") as HTMLStyleElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(typeof node.attributes._cssText).toBe("string")
      expect(node.attributes._cssText as string).toContain(".foo")
      expect(node.attributes._cssText as string).toContain("color: red")
    })
  })

  test("tolerates cross-origin <style> sheet access errors", () => {
    withDOM(`<style>.foo { color: red; }</style>`, (doc) => {
      const el = doc.querySelector("style") as HTMLStyleElement
      Object.defineProperty(el, "sheet", {
        get() {
          throw new Error("SecurityError: cross-origin")
        },
      })
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.tagName).toBe("style")
      expect(node.attributes._cssText).toBeUndefined()
    })
  })

  test("absolutizes <link rel=stylesheet> href", () => {
    withDOM(`<link rel=stylesheet href="/style.css">`, (doc) => {
      const el = doc.querySelector("link") as HTMLLinkElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.href).toBe("http://localhost/style.css")
    })
  })

  test("absolutizes <a href>", () => {
    withDOM(`<a href="/docs">click</a>`, (doc) => {
      const el = doc.querySelector("a") as HTMLAnchorElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.href).toBe("http://localhost/docs")
    })
  })

  test("absolutizes <img src>", () => {
    withDOM(`<img src="/logo.png">`, (doc) => {
      const el = doc.querySelector("img") as HTMLImageElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.src).toBe("http://localhost/logo.png")
    })
  })

  test("absolutizes each URL in <img srcset>", () => {
    withDOM(`<img src="/a.png" srcset="/a.png 1x, /b.png 2x">`, (doc) => {
      const el = doc.querySelector("img") as HTMLImageElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      const srcset = node.attributes.srcset as string
      expect(srcset).toContain("http://localhost/a.png 1x")
      expect(srcset).toContain("http://localhost/b.png 2x")
    })
  })

  test("leaves already-absolute URLs untouched", () => {
    withDOM(`<a href="https://example.com/docs">x</a>`, (doc) => {
      const el = doc.querySelector("a") as HTMLAnchorElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.href).toBe("https://example.com/docs")
    })
  })

  test("does not absolutize hash-only or javascript: hrefs", () => {
    withDOM(`<a href="#section">x</a><a href="javascript:void(0)">y</a>`, (doc) => {
      const anchors = Array.from(doc.querySelectorAll("a")) as HTMLAnchorElement[]
      const first = serializeNodeWithChildren(anchors[0]!, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      const second = serializeNodeWithChildren(anchors[1]!, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(first.attributes.href).toBe("#section")
      expect(second.attributes.href).toBe("javascript:void(0)")
    })
  })
})
