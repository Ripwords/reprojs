import { useState, useEffect } from "react"
import type { Shape } from "@reprojs/sdk-utils"
import type { AnnotationStore } from "./store"

export function useAnnotationShapes(store: AnnotationStore): Shape[] {
  const [shapes, setShapes] = useState<Shape[]>(store.snapshot())
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setShapes(store.snapshot()))
    return unsubscribe
  }, [store])
  return shapes
}
