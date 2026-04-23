import React from "react"
import { Pressable, Text, View } from "react-native"
import type { Tool } from "@reprojs/sdk-utils"
import type { AnnotationStore } from "./store"

interface Props {
  tool: Tool
  onToolChange: (t: Tool) => void
  store: AnnotationStore
}

const TOOLS: Tool[] = ["pen", "arrow", "rect", "highlight", "text"]

export function AnnotationToolbar({ tool, onToolChange, store }: Props) {
  return (
    <View style={{ flexDirection: "row", padding: 8, gap: 8 }}>
      {TOOLS.map((t) => (
        <Pressable
          key={t}
          onPress={() => onToolChange(t)}
          style={{ padding: 8, backgroundColor: t === tool ? "#6366f1" : "#e5e7eb" }}
        >
          <Text style={{ color: t === tool ? "white" : "#111" }}>{t}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => store.undo()} style={{ padding: 8, backgroundColor: "#e5e7eb" }}>
        <Text>undo</Text>
      </Pressable>
      <Pressable onPress={() => store.redo()} style={{ padding: 8, backgroundColor: "#e5e7eb" }}>
        <Text>redo</Text>
      </Pressable>
      <Pressable onPress={() => store.clear()} style={{ padding: 8, backgroundColor: "#e5e7eb" }}>
        <Text>clear</Text>
      </Pressable>
    </View>
  )
}
