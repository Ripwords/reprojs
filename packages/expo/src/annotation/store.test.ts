import { test, expect } from "bun:test"
import { createAnnotationStore } from "./store"
import { newShapeId } from "@reprojs/sdk-utils"
import type { Shape } from "@reprojs/sdk-utils"

function rect(color = "#f00", x = 0): Shape {
  return { kind: "rect", id: newShapeId(), color, strokeWidth: 2, x, y: 0, w: 1, h: 1 }
}

test("addShape appends and snapshot returns the list", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  expect(s.snapshot()).toHaveLength(1)
})

test("undo removes last, redo re-adds", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  s.undo()
  expect(s.snapshot()).toHaveLength(0)
  s.redo()
  expect(s.snapshot()).toHaveLength(1)
})

test("addShape after undo discards redo stack", () => {
  const s = createAnnotationStore()
  s.addShape(rect("#f00", 0))
  s.undo()
  s.addShape(rect("#0f0", 1))
  expect(s.snapshot()).toHaveLength(1)
  s.redo() // no-op
  expect(s.snapshot()).toHaveLength(1)
})

test("clear empties and resets stacks", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  s.clear()
  expect(s.snapshot()).toEqual([])
  s.redo()
  expect(s.snapshot()).toEqual([])
})

test("canUndo is false on empty store, true after addShape", () => {
  const s = createAnnotationStore()
  expect(s.canUndo()).toBe(false)
  s.addShape(rect())
  expect(s.canUndo()).toBe(true)
  s.undo()
  expect(s.canUndo()).toBe(false)
})

test("canRedo is false initially, true after undo, false after redo", () => {
  const s = createAnnotationStore()
  expect(s.canRedo()).toBe(false)
  s.addShape(rect())
  expect(s.canRedo()).toBe(false)
  s.undo()
  expect(s.canRedo()).toBe(true)
  s.redo()
  expect(s.canRedo()).toBe(false)
})

test("canRedo is false after addShape clears redo stack", () => {
  const s = createAnnotationStore()
  s.addShape(rect("#f00", 0))
  s.undo()
  expect(s.canRedo()).toBe(true)
  s.addShape(rect("#0f0", 1))
  expect(s.canRedo()).toBe(false)
})
