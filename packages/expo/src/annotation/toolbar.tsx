import React from "react"
import { Pressable, View } from "react-native"
import type { Tool } from "@reprojs/sdk-utils"
import { PALETTE, STROKE_WIDTHS } from "@reprojs/sdk-utils"
import type { AnnotationStore } from "./store"
import {
  PenIcon,
  ArrowIcon,
  RectIcon,
  HighlightIcon,
  TextIcon,
  UndoIcon,
  RedoIcon,
  TrashIcon,
} from "./icons"
import { useAnnotationShapes } from "./use-shapes"

interface Props {
  tool: Tool
  onToolChange: (t: Tool) => void
  color: string
  onColorChange: (c: string) => void
  strokeWidth: number
  onStrokeWidthChange: (w: number) => void
  store: AnnotationStore
}

const TOOLS: { key: Tool; Icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { key: "pen", Icon: PenIcon },
  { key: "arrow", Icon: ArrowIcon },
  { key: "rect", Icon: RectIcon },
  { key: "highlight", Icon: HighlightIcon },
  { key: "text", Icon: TextIcon },
]

const ACTIVE_BG = "#6366f1"
const INACTIVE_BG = "#f3f4f6"
const ACTIVE_ICON = "#ffffff"
const INACTIVE_ICON = "#111827"
const DISABLED_OPACITY = 0.35
const HIT_SIZE = 44

export function AnnotationToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  store,
}: Props) {
  // Subscribe to store so canUndo/canRedo trigger re-render
  useAnnotationShapes(store)

  const canUndo = store.canUndo()
  const canRedo = store.canRedo()

  return (
    <View style={{ backgroundColor: "#ffffff", paddingHorizontal: 8, paddingVertical: 4, gap: 4 }}>
      {/* Row 1: tool buttons + undo/redo/trash */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {TOOLS.map(({ key, Icon }) => {
          const active = key === tool
          return (
            <Pressable
              key={key}
              onPress={() => onToolChange(key)}
              style={{
                width: HIT_SIZE,
                height: HIT_SIZE,
                borderRadius: 8,
                backgroundColor: active ? ACTIVE_BG : INACTIVE_BG,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={22} color={active ? ACTIVE_ICON : INACTIVE_ICON} />
            </Pressable>
          )
        })}

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Undo */}
        <Pressable
          onPress={() => store.undo()}
          disabled={!canUndo}
          style={{
            width: HIT_SIZE,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
            opacity: canUndo ? 1 : DISABLED_OPACITY,
          }}
        >
          <UndoIcon size={22} color={INACTIVE_ICON} />
        </Pressable>

        {/* Redo */}
        <Pressable
          onPress={() => store.redo()}
          disabled={!canRedo}
          style={{
            width: HIT_SIZE,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
            opacity: canRedo ? 1 : DISABLED_OPACITY,
          }}
        >
          <RedoIcon size={22} color={INACTIVE_ICON} />
        </Pressable>

        {/* Trash / clear */}
        <Pressable
          onPress={() => store.clear()}
          style={{
            width: HIT_SIZE,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <TrashIcon size={22} color={INACTIVE_ICON} />
        </Pressable>
      </View>

      {/* Row 2: color swatches + stroke widths */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 4,
        }}
      >
        {/* Color swatches */}
        <View style={{ flexDirection: "row" }}>
          {PALETTE.map((swatch) => {
            const active = swatch === color
            return (
              <Pressable
                key={swatch}
                onPress={() => onColorChange(swatch)}
                hitSlop={4}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: swatch,
                    borderWidth: active ? 2 : 0,
                    borderColor: "#6366f1",
                  }}
                />
              </Pressable>
            )
          })}
        </View>

        {/* Stroke width dots */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {STROKE_WIDTHS.map((w) => {
            const active = w === strokeWidth
            const dotSize = Math.min(w * 2 + 4, 16)
            return (
              <Pressable
                key={w}
                onPress={() => onStrokeWidthChange(w)}
                hitSlop={4}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: active ? "#6366f1" : "#111827",
                  }}
                />
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}
