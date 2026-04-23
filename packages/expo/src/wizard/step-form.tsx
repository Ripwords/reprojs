import React from "react"
import { TextInput, View, Text } from "react-native"

interface Props {
  title: string
  description: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
}

export function StepForm({ title, description, onTitleChange, onDescriptionChange }: Props) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontWeight: "600" }}>Title</Text>
      <TextInput
        value={title}
        onChangeText={onTitleChange}
        maxLength={120}
        placeholder="Short description of the issue"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 8, borderRadius: 6 }}
      />
      <Text style={{ fontWeight: "600" }}>Details (optional)</Text>
      <TextInput
        value={description}
        onChangeText={onDescriptionChange}
        maxLength={10000}
        multiline
        placeholder="Steps to reproduce, expected vs actual"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 8,
          borderRadius: 6,
          minHeight: 120,
        }}
      />
    </View>
  )
}
