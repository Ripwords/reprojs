import React from "react"
import { Path, Rect, Text as SvgText, Line } from "react-native-svg"
import type { Shape } from "@reprojs/sdk-utils"

export function renderShape(s: Shape, key: string | number): React.ReactNode {
  if (s.kind === "pen") {
    const d = s.points.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ")
    return <Path key={key} d={d} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />
  }
  if (s.kind === "rect") {
    return (
      <Rect
        key={key}
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
        fill="none"
      />
    )
  }
  if (s.kind === "highlight") {
    return (
      <Rect
        key={key}
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
        fill={s.color}
        opacity={0.25}
      />
    )
  }
  if (s.kind === "arrow") {
    return (
      <Line
        key={key}
        x1={s.x1}
        y1={s.y1}
        x2={s.x2}
        y2={s.y2}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
      />
    )
  }
  if (s.kind === "text") {
    return (
      <SvgText key={key} x={s.x} y={s.y} fontSize={s.fontSize} fill={s.color}>
        {s.content}
      </SvgText>
    )
  }
  return null
}
