import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { StepReview } from "./step-review"

function setupDom() {
  const win = new Window()
  // @ts-expect-error
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  return win
}

// Walk DOM tree to find first element with the given class.
function walkForClass(node: Element, cls: string): Element | null {
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) return node
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) {
      const found = walkForClass(child as Element, cls)
      if (found) return found
    }
  }
  return null
}

describe("StepReview", () => {
  test("renders the summary lines", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [{ label: "Title & description" }, { label: "Annotated screenshot" }],
        error: null,
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Included in this report")
    expect(root.textContent).toContain("Title & description")
    expect(root.textContent).toContain("Annotated screenshot")
  })

  test("renders an error card when error is present", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [{ label: "anything" }],
        error: "Something went wrong",
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Something went wrong")
    expect(walkForClass(root as unknown as Element, "ft-error-card")).toBeTruthy()
  })

  test("renders a hint suffix when SummaryLine has hint", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [{ label: "Annotations", hint: "3" }],
        error: null,
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("3")
  })
})
