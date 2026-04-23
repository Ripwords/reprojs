import React from "react"
import { Path, Rect, Text as SvgText } from "react-native-svg"
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
    // Shaft + open arrowhead rendered as a single Path so stroke joins line up cleanly.
    // Arrowhead wings sit at ±30° from the shaft, scaled by strokeWidth with a floor.
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
    const headLen = Math.max(12, s.strokeWidth * 4)
    const headAngle = Math.PI / 6
    const leftX = s.x2 - headLen * Math.cos(angle - headAngle)
    const leftY = s.y2 - headLen * Math.sin(angle - headAngle)
    const rightX = s.x2 - headLen * Math.cos(angle + headAngle)
    const rightY = s.y2 - headLen * Math.sin(angle + headAngle)
    const d = `M${s.x1},${s.y1} L${s.x2},${s.y2} M${leftX},${leftY} L${s.x2},${s.y2} L${rightX},${rightY}`
    return (
      <Path
        key={key}
        d={d}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
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
