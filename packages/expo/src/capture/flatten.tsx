import React, { forwardRef, useImperativeHandle, useRef } from "react"
import { Image, View } from "react-native"
import Svg, { Path, Rect, Text as SvgText, Line } from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import type { Shape } from "@reprojs/sdk-utils"

export interface FlattenHandle {
  flatten: () => Promise<{ uri: string }>
}

interface Props {
  uri: string
  width: number
  height: number
  shapes: Shape[]
}

export const FlattenView = forwardRef<FlattenHandle, Props>(function FlattenView(
  { uri, width, height, shapes },
  ref,
) {
  const viewRef = useRef<View>(null)
  useImperativeHandle(ref, () => ({
    flatten: async () => {
      if (!viewRef.current) throw new Error("Repro: flatten view not mounted")
      const out = await captureRef(viewRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      })
      return { uri: out }
    },
  }))
  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={{ position: "absolute", left: -9999, width, height }}
    >
      <Image source={{ uri }} style={{ width, height }} />
      <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
        {shapes.map((s, i) => renderShape(s, i))}
      </Svg>
    </View>
  )
})

function renderShape(s: Shape, key: number): React.ReactNode {
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
