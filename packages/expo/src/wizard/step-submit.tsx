import React from "react"
import { Pressable, Text, View, ActivityIndicator } from "react-native"

interface Props {
  submitting: boolean
  error: string | null
  onSubmit: () => void
  onCancel: () => void
}

export function StepSubmit({ submitting, error, onSubmit, onCancel }: Props) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error && <Text style={{ color: "#dc2626" }}>{error}</Text>}
      <Pressable
        onPress={onSubmit}
        disabled={submitting}
        style={{ backgroundColor: "#6366f1", padding: 12, borderRadius: 6, alignItems: "center" }}
      >
        {submitting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={{ color: "white" }}>Submit</Text>
        )}
      </Pressable>
      <Pressable onPress={onCancel} style={{ padding: 12, alignItems: "center" }}>
        <Text>Cancel</Text>
      </Pressable>
    </View>
  )
}
