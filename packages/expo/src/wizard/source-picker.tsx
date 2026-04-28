import React from "react"
import { Modal, Pressable, Text, View } from "react-native"
import { theme } from "./theme"

export type AttachmentSource = "files" | "photos" | "clipboard"

interface Props {
  visible: boolean
  hasClipboardImage: boolean
  onSelect: (source: AttachmentSource) => void
  onCancel: () => void
}

interface Row {
  source: AttachmentSource
  icon: string
  label: string
  detail: string
}

const ROWS: Row[] = [
  { source: "photos", icon: "🖼", label: "Photos", detail: "Pick from your photo library" },
  { source: "files", icon: "📄", label: "Files", detail: "Documents, PDFs, screenshots" },
  {
    source: "clipboard",
    icon: "📋",
    label: "Paste image",
    detail: "Use the image on your clipboard",
  },
]

/**
 * Bottom-sheet style action picker shown when the user taps the
 * Attachments dropzone in the Expo wizard. Three sources: Photos,
 * Files, Clipboard. The Clipboard row is rendered but disabled when
 * `hasClipboardImage` is false so the user understands why it didn't
 * fire — better than silently doing nothing.
 *
 * Uses `Modal` directly rather than ActionSheetIOS so the same UI lands
 * on iOS and Android without a new peer dep.
 */
export function SourcePicker({ visible, hasClipboardImage, onSelect, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          // Inner pressable swallows the outer's tap-to-dismiss so taps on
          // the sheet itself don't close it.
          onPress={() => {}}
          style={{
            backgroundColor: theme.color.bg,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 24,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.color.border,
              marginBottom: 12,
            }}
          />
          <Text
            style={{
              paddingHorizontal: 8,
              paddingBottom: 8,
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: theme.color.textMuted,
            }}
          >
            Add attachment from
          </Text>
          {ROWS.map((row) => {
            const disabled = row.source === "clipboard" && !hasClipboardImage
            return (
              <Pressable
                key={row.source}
                onPress={() => !disabled && onSelect(row.source)}
                disabled={disabled}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed && !disabled ? theme.color.surfaceSoft : "transparent",
                  opacity: disabled ? 0.45 : 1,
                })}
              >
                <Text style={{ fontSize: 22 }}>{row.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: theme.color.text }}>
                    {row.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.color.textMuted, marginTop: 2 }}>
                    {disabled ? "No image on the clipboard" : row.detail}
                  </Text>
                </View>
              </Pressable>
            )
          })}
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => ({
              marginTop: 8,
              paddingVertical: 14,
              alignItems: "center",
              borderRadius: theme.radius.md,
              backgroundColor: pressed ? theme.color.surfaceSoft : "transparent",
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "500", color: theme.color.textMuted }}>
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
