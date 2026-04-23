import React from "react"
import { ScrollView, TextInput, View } from "react-native"
import { FieldLabel, inputStyle } from "./controls"
import { theme } from "./theme"

interface Props {
  title: string
  description: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
}

export function StepForm({ title, description, onTitleChange, onDescriptionChange }: Props) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={{ gap: 8 }}>
        <FieldLabel label="Title" />
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          placeholder="What went wrong?"
          placeholderTextColor={theme.color.textFaint}
          maxLength={120}
          returnKeyType="next"
          style={inputStyle}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Details" optional />
        <TextInput
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Steps to reproduce, expected vs actual…"
          placeholderTextColor={theme.color.textFaint}
          multiline
          maxLength={10000}
          style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
        />
      </View>
    </ScrollView>
  )
}
