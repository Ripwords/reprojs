import type { Shape } from "@reprojs/sdk-utils"

export interface AnnotationStore {
  addShape: (s: Shape) => void
  undo: () => void
  redo: () => void
  clear: () => void
  snapshot: () => Shape[]
  subscribe: (fn: () => void) => () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export function createAnnotationStore(): AnnotationStore {
  let shapes: Shape[] = []
  let redoStack: Shape[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }
  return {
    addShape(s) {
      shapes = [...shapes, s]
      redoStack = []
      notify()
    },
    undo() {
      if (!shapes.length) return
      const popped = shapes[shapes.length - 1]
      shapes = shapes.slice(0, -1)
      if (popped) redoStack = [...redoStack, popped]
      notify()
    },
    redo() {
      if (!redoStack.length) return
      const last = redoStack[redoStack.length - 1]
      redoStack = redoStack.slice(0, -1)
      if (last) shapes = [...shapes, last]
      notify()
    },
    clear() {
      shapes = []
      redoStack = []
      notify()
    },
    snapshot: () => shapes,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    canUndo: () => shapes.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}
