import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createMask } from "./mask"

function withDOM(html: string, fn: (doc: Document) => void): void {
  const win = new Window({ url: "http://localhost/" })
  // happy-dom 20.x omits SyntaxError from the Window object, which breaks its
  // querySelector/matches error path. Patch it so selector APIs work.
  ;(win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError
  win.document.body.innerHTML = html
  fn(win.document as unknown as Document)
}

describe("createMask", () => {
  test("moderate masks password, email, tel, number inputs but not text/textarea", () => {
    withDOM(
      `<input type=password id=p><input type=email id=e><input type=tel id=t><input type=number id=n><input type=text id=x><textarea id=ta></textarea>`,
      (doc) => {
        const mask = createMask({ masking: "moderate" })
        expect(mask.shouldMaskInput(doc.getElementById("p") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("e") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("t") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("n") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("x") as HTMLInputElement)).toBe(false)
        expect(mask.shouldMaskInput(doc.getElementById("ta") as unknown as HTMLInputElement)).toBe(
          false,
        )
      },
    )
  })

  test("strict masks all input/textarea/select", () => {
    withDOM(`<input type=text id=x><textarea id=ta></textarea><select id=s></select>`, (doc) => {
      const mask = createMask({ masking: "strict" })
      expect(mask.shouldMaskInput(doc.getElementById("x") as HTMLInputElement)).toBe(true)
      expect(mask.shouldMaskInput(doc.getElementById("ta") as unknown as HTMLInputElement)).toBe(
        true,
      )
      expect(mask.shouldMaskInput(doc.getElementById("s") as unknown as HTMLInputElement)).toBe(
        true,
      )
    })
  })

  test("minimal masks only password + data-feedback-mask", () => {
    withDOM(
      `<input type=password id=p><input type=email id=e><input type=text id=m data-feedback-mask>`,
      (doc) => {
        const mask = createMask({ masking: "minimal" })
        expect(mask.shouldMaskInput(doc.getElementById("p") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("e") as HTMLInputElement)).toBe(false)
        expect(mask.shouldMaskInput(doc.getElementById("m") as HTMLInputElement)).toBe(true)
      },
    )
  })

  test("data-feedback-mask on ancestor masks descendants", () => {
    withDOM(`<div data-feedback-mask><input type=text id=t></div>`, (doc) => {
      const mask = createMask({ masking: "moderate" })
      expect(mask.shouldMaskInput(doc.getElementById("t") as HTMLInputElement)).toBe(true)
    })
  })

  test("shouldBlock returns true for data-feedback-block subtree in all modes", () => {
    withDOM(`<div data-feedback-block><span id=s>secret</span></div>`, (doc) => {
      for (const mode of ["strict", "moderate", "minimal"] as const) {
        const mask = createMask({ masking: mode })
        expect(mask.shouldBlock(doc.getElementById("s") as HTMLElement)).toBe(true)
      }
    })
  })

  test("maskValue replaces with same-length asterisks", () => {
    const mask = createMask({ masking: "moderate" })
    expect(mask.maskValue("secret")).toBe("******")
    expect(mask.maskValue("")).toBe("")
  })

  test("custom maskSelectors and blockSelectors", () => {
    withDOM(`<input class=secret id=s><div class=off-limits id=d></div>`, (doc) => {
      const mask = createMask({
        masking: "minimal",
        maskSelectors: [".secret"],
        blockSelectors: [".off-limits"],
      })
      expect(mask.shouldMaskInput(doc.getElementById("s") as HTMLInputElement)).toBe(true)
      expect(mask.shouldBlock(doc.getElementById("d") as HTMLElement)).toBe(true)
    })
  })
})
