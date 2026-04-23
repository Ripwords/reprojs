import React from "react"
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native"
import { theme } from "./theme"

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  fullWidth = true,
}: {
  label: string
  onPress?: () => void
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: disabled
          ? theme.color.primaryDisabled
          : pressed
            ? theme.color.primaryPressed
            : theme.color.primary,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: theme.radius.md,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        minHeight: 52,
        alignSelf: fullWidth ? "stretch" : "flex-start",
        shadowColor: theme.color.primary,
        shadowOpacity: disabled ? 0 : 0.25,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: disabled ? 0 : 4,
      })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text
          style={{
            color: "#ffffff",
            fontSize: 16,
            fontWeight: "600",
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string
  onPress?: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: theme.radius.md,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.55 : 1,
        minHeight: 52,
      })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={{
          color: theme.color.textMuted,
          fontSize: 15,
          fontWeight: "500",
          letterSpacing: 0.1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function StepIndicator({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 18,
      }}
    >
      {steps.map((label, i) => {
        const active = i === current
        const done = i < current
        const dotBg = active || done ? theme.color.primary : theme.color.surface
        const dotLabelColor = active || done ? "#ffffff" : theme.color.textFaint
        const labelColor = active
          ? theme.color.text
          : done
            ? theme.color.textMuted
            : theme.color.textFaint
        return (
          <React.Fragment key={label}>
            <View style={{ alignItems: "center", gap: 6, minWidth: 60 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: dotBg,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: dotLabelColor,
                  }}
                >
                  {i + 1}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: active ? "600" : "500",
                  color: labelColor,
                  letterSpacing: 0.2,
                }}
              >
                {label}
              </Text>
            </View>
            {i < steps.length - 1 && (
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: done ? theme.color.primary : theme.color.border,
                  marginTop: 11,
                  marginHorizontal: 6,
                  borderRadius: 1,
                }}
              />
            )}
          </React.Fragment>
        )
      })}
    </View>
  )
}

export function FieldLabel({
  label,
  optional,
  style,
}: {
  label: string
  optional?: boolean
  style?: ViewStyle
}) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "baseline", gap: 8 }, style]}>
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: theme.color.text,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {optional && (
        <Text
          style={{
            fontSize: 11,
            color: theme.color.textFaint,
            fontStyle: "italic",
          }}
        >
          optional
        </Text>
      )}
    </View>
  )
}

export const inputStyle = {
  backgroundColor: theme.color.surfaceSoft,
  borderWidth: 1,
  borderColor: theme.color.border,
  borderRadius: theme.radius.md,
  paddingVertical: 14,
  paddingHorizontal: 14,
  fontSize: 16,
  color: theme.color.text,
} as const
