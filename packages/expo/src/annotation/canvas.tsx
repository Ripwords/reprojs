import React, { useState } from "react"
import { View } from "react-native"
import { GestureDetector, Gesture } from "react-native-gesture-handler"
import Svg, { Path } from "react-native-svg"
import type { AnnotationStore } from "./store"
import type { Shape, Tool, PenPoint } from "@reprojs/sdk-utils"
import { newShapeId } from "@reprojs/sdk-utils"

interface Props {
  width: number
  height: number
  tool: Tool
  color: string
  strokeWidth: number
  store: AnnotationStore
}

export function AnnotationCanvas({ width, height, tool, color, strokeWidth, store }: Props) {
  const [draft, setDraft] = useState<PenPoint[]>([])

  const pan = Gesture.Pan()
    .onStart((e) => {
      setDraft([{ x: e.x, y: e.y, p: 1 }])
    })
    .onUpdate((e) => {
      setDraft((d) => [...d, { x: e.x, y: e.y, p: 1 }])
    })
    .onEnd(() => {
      if (draft.length === 0) {
        setDraft([])
        return
      }
      const shape = buildShape(tool, draft, color, strokeWidth)
      if (shape) store.addShape(shape)
      setDraft([])
    })

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          {store.snapshot().map((s, i) => renderCommitted(s, i))}
          {draft.length > 0 && renderDraft(tool, draft, color, strokeWidth)}
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
  if (tool === "text")
    return {
      kind: "text",
      id,
      color,
      strokeWidth,
      x: first.x,
      y: first.y,
      w: 120,
      h: 24,
      content: "Tap to edit",
      fontSize: 16,
    }
  return null
}

function renderCommitted(s: Shape, key: number): React.ReactNode {
  if (s.kind === "pen") {
    const d = s.points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ")
    return <Path key={key} d={d} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />
  }
  // v1: only pen strokes rendered in-canvas; other shapes appear via the flatten view on submit.
  return null
}

function renderDraft(
  tool: Tool,
  points: PenPoint[],
  color: string,
  strokeWidth: number,
): React.ReactNode {
  if (tool !== "pen") return null
  const d = points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ")
  return <Path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" />
}
