import React, { useState } from "react"
import { Image, Text, View } from "react-native"
import { AnnotationCanvas } from "../annotation/canvas"
import { AnnotationToolbar } from "../annotation/toolbar"
import { TextInputModal } from "../annotation/text-input-modal"
import type { AnnotationStore } from "../annotation/store"
import type { Tool } from "@reprojs/sdk-utils"
import { PALETTE, STROKE_WIDTHS, newShapeId } from "@reprojs/sdk-utils"

interface Props {
  imageUri: string | null
  width: number
  height: number
  store: AnnotationStore
}

export function StepAnnotate({ imageUri, width, height, store }: Props) {
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState<string>(PALETTE[0])
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[1])
  const [textPoint, setTextPoint] = useState<{ x: number; y: number } | null>(null)

  function handleTextTap(point: { x: number; y: number }) {
    setTextPoint(point)
  }

  function handleTextSubmit(value: string) {
    if (!textPoint) return
    store.addShape({
      kind: "text",
      id: newShapeId(),
      color,
      strokeWidth,
      x: textPoint.x,
      y: textPoint.y,
      w: 0,
      h: 0,
      content: value,
      fontSize: 16,
    })
    setTextPoint(null)
  }

  function handleTextCancel() {
    setTextPoint(null)
  }

  return (
    <View style={{ flex: 1 }}>
      <AnnotationToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        store={store}
      />
      <View style={{ width, height, position: "relative", backgroundColor: "#f3f4f6" }}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ position: "absolute", top: 0, left: 0, width, height }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width,
              height,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Text style={{ color: "#6b7280", textAlign: "center" }}>
              Screenshot unavailable — annotate on a blank canvas, or go Back and try again.
            </Text>
          </View>
        )}
        <AnnotationCanvas
          width={width}
          height={height}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          store={store}
          onTextTap={handleTextTap}
        />
      </View>
      <TextInputModal
        visible={textPoint !== null}
        onSubmit={handleTextSubmit}
        onCancel={handleTextCancel}
      />
    </View>
  )
}
