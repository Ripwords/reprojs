import { computed, signal } from "@preact/signals"
import {
  IDENTITY_TRANSFORM,
  PALETTE,
  type Shape,
  type Tool,
  type Transform,
} from "@reprojs/sdk-utils"
export { newShapeId } from "@reprojs/sdk-utils"

export const shapes = signal<Shape[]>([])
export const undone = signal<Shape[]>([])
export const tool = signal<Tool>("arrow")
export const color = signal<string>(PALETTE[0])
export const strokeW = signal<number>(4)
export const viewport = signal<Transform>(IDENTITY_TRANSFORM)
export const draft = signal<Shape | null>(null)

export const canUndo = computed(() => shapes.value.length > 0)
export const canRedo = computed(() => undone.value.length > 0)

export function commit(s: Shape): void {
  shapes.value = [...shapes.value, s]
  undone.value = []
}

export function undo(): void {
  if (shapes.value.length === 0) return
  const next = [...shapes.value]
  const popped = next.pop() as Shape
  shapes.value = next
  undone.value = [...undone.value, popped]
}

export function redo(): void {
  if (undone.value.length === 0) return
  const next = [...undone.value]
  const popped = next.pop() as Shape
  undone.value = next
  shapes.value = [...shapes.value, popped]
}

export function clear(): void {
  shapes.value = []
  undone.value = []
}

export function reset(): void {
  shapes.value = []
  undone.value = []
  draft.value = null
  tool.value = "arrow"
  color.value = PALETTE[0]
  strokeW.value = 4
  viewport.value = IDENTITY_TRANSFORM
}
