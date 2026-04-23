import React, { useState, useEffect } from "react"
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native"

interface Props {
  visible: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function TextInputModal({ visible, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("")

  useEffect(() => {
    if (!visible) setValue("")
  }, [visible])

  return (
    <Modal transparent visible={visible} onRequestClose={onCancel} animationType="fade">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View style={{ backgroundColor: "white", borderRadius: 12, padding: 16, gap: 12 }}>
          <Text style={{ fontWeight: "600", fontSize: 16 }}>Add label</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            placeholder="Type your annotation"
            maxLength={200}
            style={{
              borderWidth: 1,
              borderColor: "#d1d5db",
              borderRadius: 8,
              padding: 10,
              fontSize: 16,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
            <Pressable onPress={onCancel} style={{ padding: 10 }}>
              <Text>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const trimmed = value.trim()
                if (trimmed) onSubmit(trimmed)
              }}
              disabled={!value.trim()}
              style={{
                padding: 10,
                backgroundColor: value.trim() ? "#6366f1" : "#c7d2fe",
                borderRadius: 8,
              }}
            >
              <Text style={{ color: "white" }}>Add</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
