import React, { forwardRef, useImperativeHandle, useRef } from "react"
import { Image, View } from "react-native"
import Svg from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import type { Shape } from "@reprojs/sdk-utils"
import { renderShape } from "../annotation/render-shape"

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
