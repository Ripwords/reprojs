import { describe, expect, test } from "bun:test"
import { wrapText, type MeasureFn } from "./text-wrap"

const fixedWidth =
  (px: number): MeasureFn =>
  (s) => ({ width: s.length * px })

describe("wrapText", () => {
  test("returns one line when text fits", () => {
    expect(wrapText(fixedWidth(7), "hello world", 200)).toEqual(["hello world"])
  })

  test("wraps at word boundary", () => {
    expect(wrapText(fixedWidth(7), "hello world foo bar", 49)).toEqual([
      "hello",
      "world",
      "foo bar",
    ])
  })

  test("breaks a single long word that exceeds maxWidth", () => {
    expect(wrapText(fixedWidth(7), "supercalifragilistic", 49)).toEqual([
      "superca",
      "lifragi",
      "listic",
    ])
  })

  test("preserves explicit newlines", () => {
    expect(wrapText(fixedWidth(7), "line one\nline two", 200)).toEqual(["line one", "line two"])
  })

  test("preserves empty lines (paragraph breaks)", () => {
    expect(wrapText(fixedWidth(7), "a\n\nb", 200)).toEqual(["a", "", "b"])
  })

  test("empty input returns empty array", () => {
    expect(wrapText(fixedWidth(7), "", 200)).toEqual([])
  })
})
