import React from "react"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
import type { Attachment, AttachmentLimits } from "@reprojs/sdk-utils"
import { theme } from "./theme"

interface Props {
  attachments: Attachment[]
  limits: AttachmentLimits
  errors?: string[]
  onAdd: () => void
  onRemove: (id: string) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentList({ attachments, limits, errors, onAdd, onRemove }: Props) {
  const totalBytes = attachments.reduce((n, a) => n + a.size, 0)
  const atCap = attachments.length >= limits.maxCount

  return (
    <View style={{ gap: 12 }}>
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {attachments.map((a) => (
            <View
              key={a.id}
              style={{
                width: 110,
                gap: 6,
                backgroundColor: theme.color.surfaceSoft,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.color.border,
                padding: 8,
              }}
            >
              <View
                style={{
                  width: "100%",
                  aspectRatio: 4 / 3,
                  borderRadius: theme.radius.sm,
                  backgroundColor: theme.color.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {a.isImage && a.previewUrl ? (
                  <Image
                    source={{ uri: a.previewUrl }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 22, color: theme.color.textMuted }}>📄</Text>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{ fontSize: 12, fontWeight: "600", color: theme.color.text }}
              >
                {a.filename}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: theme.color.textMuted,
                }}
              >
                {formatBytes(a.size)}
              </Text>
              <Pressable
                onPress={() => onRemove(a.id)}
                hitSlop={8}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 22,
                  height: 22,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.bg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                accessibilityLabel={`Remove ${a.filename}`}
              >
                <Text style={{ fontSize: 12, color: theme.color.textMuted }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pressable
          onPress={onAdd}
          disabled={atCap}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: theme.color.border,
            backgroundColor: theme.color.bg,
            opacity: atCap ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 13, color: theme.color.textMuted }}>
            {atCap ? `${attachments.length} of ${limits.maxCount}` : "+ Add files"}
          </Text>
        </Pressable>
        <Text
          style={{
            fontSize: 12,
            color: theme.color.textMuted,
          }}
        >
          {`${attachments.length} / ${limits.maxCount} · ${formatBytes(totalBytes)}`}
        </Text>
      </View>

      {errors && errors.length > 0 && (
        <View style={{ gap: 4 }}>
          {errors.map((m) => (
            <Text key={m} style={{ fontSize: 12, color: theme.color.danger }}>
              {m}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}
