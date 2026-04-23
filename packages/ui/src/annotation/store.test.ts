import { beforeEach, describe, expect, test } from "bun:test"
import { canRedo, canUndo, clear, commit, reset, shapes, undo, undone, redo } from "./store"
import type { ArrowShape } from "@reprojs/sdk-utils"

const makeArrow = (id: string): ArrowShape => ({
  kind: "arrow",
  id,
  color: "#e53935",
  strokeWidth: 4,
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
})

describe("annotation store", () => {
  beforeEach(() => reset())

  test("commit appends a shape", () => {
    commit(makeArrow("a"))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].id).toBe("a")
    expect(canUndo.value).toBe(true)
    expect(canRedo.value).toBe(false)
  })

  test("undo moves latest shape to the redo stack", () => {
    commit(makeArrow("a"))
    commit(makeArrow("b"))
    undo()
    expect(shapes.value.map((s) => s.id)).toEqual(["a"])
    expect(undone.value.map((s) => s.id)).toEqual(["b"])
    expect(canRedo.value).toBe(true)
  })

  test("redo pushes back onto shapes", () => {
    commit(makeArrow("a"))
    undo()
    redo()
    expect(shapes.value.map((s) => s.id)).toEqual(["a"])
    expect(canRedo.value).toBe(false)
  })

  test("a new commit clears the redo stack", () => {
    commit(makeArrow("a"))
    undo()
    expect(canRedo.value).toBe(true)
    commit(makeArrow("b"))
    expect(canRedo.value).toBe(false)
  })

  test("clear empties both stacks", () => {
    commit(makeArrow("a"))
    commit(makeArrow("b"))
    undo()
    clear()
    expect(shapes.value).toHaveLength(0)
    expect(undone.value).toHaveLength(0)
  })

  test("undo on empty stack is a no-op", () => {
    undo()
    expect(shapes.value).toHaveLength(0)
    expect(undone.value).toHaveLength(0)
  })

  test("redo on empty stack is a no-op", () => {
    redo()
    expect(shapes.value).toHaveLength(0)
  })
})
