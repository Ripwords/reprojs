import React from "react"
import { Text, View } from "react-native"
import { theme } from "./theme"

export interface SummaryLine {
  label: string
  hint?: string
}

interface Props {
  error: string | null
  summary?: SummaryLine[]
}

// Buttons for submit live in the wizard sheet footer so they share the same
// layout + styling with the Next/Back buttons on other steps. This step only
// renders a summary card + any error message.
export function StepSubmit({ error, summary }: Props) {
  return (
    <View style={{ flex: 1, padding: 20, gap: 16 }}>
      {summary && summary.length > 0 && (
        <View
          style={{
            backgroundColor: theme.color.surfaceSoft,
            borderRadius: theme.radius.lg,
            padding: 18,
            borderWidth: 1,
            borderColor: theme.color.border,
            gap: 14,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              color: theme.color.textMuted,
              letterSpacing: 1.3,
              textTransform: "uppercase",
            }}
          >
            Included in this report
          </Text>
          {summary.map((line) => (
            <View key={line.label} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 2.5,
                  backgroundColor: theme.color.primary,
                }}
              />
              <Text style={{ fontSize: 14, color: theme.color.text, flex: 1 }}>{line.label}</Text>
              {line.hint ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.color.textMuted,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {line.hint}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {error && (
        <View
          style={{
            backgroundColor: theme.color.dangerSoft,
            padding: 14,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.color.dangerBorder,
          }}
        >
          <Text style={{ color: theme.color.danger, fontSize: 14, fontWeight: "500" }}>
            {error}
          </Text>
        </View>
      )}
    </View>
  )
}
