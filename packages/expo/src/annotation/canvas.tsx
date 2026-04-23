import React, { useState } from "react"
import { View } from "react-native"
import { GestureDetector, Gesture } from "react-native-gesture-handler"
import Svg from "react-native-svg"
import type { AnnotationStore } from "./store"
import type { Shape, Tool, PenPoint } from "@reprojs/sdk-utils"
import { newShapeId } from "@reprojs/sdk-utils"
import { useAnnotationShapes } from "./use-shapes"
import { renderShape } from "./render-shape"

interface Props {
  width: number
  height: number
  tool: Tool
  color: string
  strokeWidth: number
  store: AnnotationStore
  onTextTap?: (point: { x: number; y: number }) => void
}

export function AnnotationCanvas({
  width,
  height,
  tool,
  color,
  strokeWidth,
  store,
  onTextTap,
}: Props) {
  const shapes = useAnnotationShapes(store)
  const [draftPoints, setDraftPoints] = useState<PenPoint[]>([])

  const pan = Gesture.Pan()
    .minDistance(2)
    .onStart((e) => {
      if (tool === "text") return
      setDraftPoints([{ x: e.x, y: e.y, p: 1 }])
    })
    .onUpdate((e) => {
      if (tool === "text") return
      setDraftPoints((d) => [...d, { x: e.x, y: e.y, p: 1 }])
    })
    .onEnd(() => {
      if (tool === "text") return
      if (draftPoints.length === 0) {
        setDraftPoints([])
        return
      }
      const shape = buildShape(tool, draftPoints, color, strokeWidth)
      if (shape) store.addShape(shape)
      setDraftPoints([])
    })

  const tap = Gesture.Tap().onEnd((e) => {
    if (tool !== "text") return
    onTextTap?.({ x: e.x, y: e.y })
  })

  const gesture = Gesture.Race(pan, tap)

  const draftShape = buildDraftShape(tool, draftPoints, color, strokeWidth)

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          {shapes.map((s, i) => renderShape(s, i))}
          {draftShape !== null ? renderShape(draftShape, "draft") : null}
        </Svg>
      </View>
    </GestureDetector>
  )
}

function buildShape(
  tool: Tool,
  points: PenPoint[],
  color: string,
  strokeWidth: number,
): Shape | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  const id = newShapeId()
  if (tool === "pen") return { kind: "pen", id, color, strokeWidth, points }
  if (tool === "arrow")
    return {
      kind: "arrow",
      id,
      color,
      strokeWidth,
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
    }
  if (tool === "rect" || tool === "highlight") {
    return {
      kind: tool,
      id,
      color,
      strokeWidth,
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      w: Math.abs(last.x - first.x),
      h: Math.abs(last.y - first.y),
    }
  }
  return null
}

function buildDraftShape(
  tool: Tool,
  points: PenPoint[],
  color: string,
  strokeWidth: number,
): Shape | null {
  if (tool === "text") return null
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  const id = "__draft__"
  if (tool === "pen") return { kind: "pen", id, color, strokeWidth, points }
  if (tool === "arrow")
    return {
      kind: "arrow",
      id,
      color,
      strokeWidth,
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
    }
  if (tool === "rect" || tool === "highlight") {
    return {
      kind: tool,
      id,
      color,
      strokeWidth,
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      w: Math.abs(last.x - first.x),
      h: Math.abs(last.y - first.y),
    }
  }
  return null
}
