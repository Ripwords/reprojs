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
      // Match the annotation canvas's backdrop color so letterbox bars on non-
      // matching-aspect screenshots blend with what the user saw while drawing.
      style={{
        position: "absolute",
        left: -9999,
        width,
        height,
        backgroundColor: "#f3f4f6",
      }}
    >
      {/* resizeMode="contain" mirrors what the StepAnnotate preview uses, so
          shape coordinates drawn on the preview land at the same pixel offsets
          in the flattened PNG — no more cover-crop that clipped top + bottom. */}
      <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
      <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
        {shapes.map((s, i) => renderShape(s, i))}
      </Svg>
    </View>
  )
})
