import React, { useState } from "react"
import { View } from "react-native"
import { AnnotationCanvas } from "../annotation/canvas"
import { AnnotationToolbar } from "../annotation/toolbar"
import type { AnnotationStore } from "../annotation/store"
import type { Tool } from "@reprojs/sdk-utils"

interface Props {
  imageUri: string
  width: number
  height: number
  store: AnnotationStore
}

export function StepAnnotate({ imageUri: _imageUri, width, height, store }: Props) {
  const [tool, setTool] = useState<Tool>("pen")
  return (
    <View style={{ flex: 1 }}>
      <AnnotationToolbar tool={tool} onToolChange={setTool} store={store} />
      <View style={{ width, height, position: "relative" }}>
        <AnnotationCanvas
          width={width}
          height={height}
          tool={tool}
          color="#ef4444"
          strokeWidth={3}
          store={store}
        />
      </View>
    </View>
  )
}
