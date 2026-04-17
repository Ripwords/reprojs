import { describe, expect, test } from "bun:test"
import { renderTemplate } from "./render-template"

describe("renderTemplate", () => {
  test("substitutes {{var}} placeholders", async () => {
    const out = await renderTemplate(
      "__test_inline",
      { name: "Alice", url: "https://x/y" },
      {
        inline: "<p>Hi {{name}}, click {{url}}</p>",
      },
    )
    expect(out).toBe("<p>Hi Alice, click https://x/y</p>")
  })

  test("leaves unknown placeholders untouched", async () => {
    const out = await renderTemplate(
      "__test_inline",
      { name: "Bob" },
      {
        inline: "<p>{{name}} / {{missing}}</p>",
      },
    )
    expect(out).toBe("<p>Bob / {{missing}}</p>")
  })

  test("escapes HTML in interpolated values", async () => {
    const out = await renderTemplate(
      "__test_inline",
      { name: "<script>x</script>" },
      {
        inline: "<p>{{name}}</p>",
      },
    )
    expect(out).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>")
  })
})
