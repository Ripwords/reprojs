import { expect, test } from "bun:test"
import { tokens } from "@reprojs/sdk-utils"
import { themeToCssVars } from "./theme-css"

test("emits :host block with kebab-cased color custom properties", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain(":host {")
  expect(css).toContain("  --ft-color-primary: #ff9b51;")
  expect(css).toContain("  --ft-color-primary-pressed: #f27a1f;")
  expect(css).toContain("  --ft-color-text: #25343f;")
  expect(css).toContain("  --ft-color-bg: #ffffff;")
  expect(css.endsWith("}\n") || css.endsWith("}")).toBe(true)
})

test("emits radius custom properties with px units", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain("  --ft-radius-sm: 8px;")
  expect(css).toContain("  --ft-radius-md: 12px;")
  expect(css).toContain("  --ft-radius-pill: 999px;")
})

test("emits the hit target custom property", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain("  --ft-hit: 44px;")
})

test("output is deterministic — same input produces same output", () => {
  expect(themeToCssVars(tokens)).toBe(themeToCssVars(tokens))
})
