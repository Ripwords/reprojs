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
        style={({ pressed }) => ({
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: pressed ? "#f27a1f" : "#ff9b51",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#ff9b51",
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 6,
        })}
      >
        {icon ?? <Text style={{ color: "white", fontSize: 22 }}>🐞</Text>}
      </Pressable>
    </View>
  )
}
