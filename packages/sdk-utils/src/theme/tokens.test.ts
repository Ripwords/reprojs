import { expect, test } from "bun:test"
import { tokens } from "./tokens"

test("tokens object exposes the expected color, radius, and hit values", () => {
  expect(tokens.color.primary).toBe("#ff9b51")
  expect(tokens.color.primaryPressed).toBe("#f27a1f")
  expect(tokens.color.bg).toBe("#ffffff")
  expect(tokens.color.text).toBe("#25343f")
  expect(tokens.radius.md).toBe(12)
  expect(tokens.hit).toBe(44)
})

test("token keys are stable — guards against accidental deletion", () => {
  expect(Object.keys(tokens.color).toSorted()).toEqual(
    [
      "bg",
      "border",
      "borderStrong",
      "danger",
      "dangerBorder",
      "dangerSoft",
      "primary",
      "primaryDisabled",
      "primaryPressed",
      "primarySoft",
      "surface",
      "surfaceSoft",
      "text",
      "textFaint",
      "textMuted",
    ].toSorted(),
  )
  expect(Object.keys(tokens.radius).toSorted()).toEqual(["lg", "md", "pill", "sm"].toSorted())
})
