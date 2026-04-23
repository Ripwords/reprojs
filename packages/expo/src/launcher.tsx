import React from "react"
import { Pressable, Text, View } from "react-native"
import { useRepro } from "./use-repro"

interface Props {
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  offset?: { top?: number; bottom?: number; left?: number; right?: number }
  icon?: React.ReactNode
  hideWhen?: () => boolean
}

export function ReproLauncher({ position = "bottom-right", offset = {}, icon, hideWhen }: Props) {
  const repro = useRepro()
  if (hideWhen?.()) return null
  const posStyles = {
    position: "absolute" as const,
    top: position.startsWith("top") ? (offset.top ?? 24) : undefined,
    bottom: position.startsWith("bottom") ? (offset.bottom ?? 24) : undefined,
    left: position.endsWith("left") ? (offset.left ?? 24) : undefined,
    right: position.endsWith("right") ? (offset.right ?? 24) : undefined,
  }
  return (
    <View style={posStyles} pointerEvents="box-none">
      <Pressable
        onPress={() => repro.open()}
        accessibilityLabel="Report a bug"
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: "#6366f1",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 8,
          elevation: 4,
        }}
      >
        {icon ?? <Text style={{ color: "white", fontSize: 20 }}>🐛</Text>}
      </Pressable>
    </View>
  )
}
