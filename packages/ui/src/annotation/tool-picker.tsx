// packages/ui/src/annotation/tool-picker.tsx
import { h } from "preact"
import { canRedo, canUndo, clear, color, redo, strokeW, tool, undo } from "./store"
import { PALETTE, STROKE_WIDTHS, type Tool } from "@reprojs/sdk-utils"

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "arrow", label: "Arrow (A)", icon: "↗" },
  { id: "rect", label: "Rectangle (R)", icon: "▢" },
  { id: "pen", label: "Pen (P)", icon: "✎" },
  { id: "highlight", label: "Highlight (H)", icon: "≡" },
  { id: "text", label: "Text (T)", icon: "T" },
]

export function ToolPicker() {
  const active = tool.value
  const activeColor = color.value
  const activeStroke = strokeW.value

  return h(
    "div",
    { class: "ft-tool-picker" },
    h(
      "div",
      { class: "ft-tool-group" },
      TOOLS.map((t) =>
        h(
          "button",
          {
            type: "button",
            class: `ft-tool ${active === t.id ? "active" : ""}`,
            "aria-label": t.label,
            "aria-pressed": active === t.id,
            title: t.label,
            onClick: () => {
              tool.value = t.id
            },
          },
          t.icon,
        ),
      ),
    ),
    h(
      "div",
      { class: "ft-tool-group" },
      PALETTE.map((c) =>
        h("button", {
          type: "button",
          class: `ft-swatch ${activeColor === c ? "active" : ""}`,
          style: `background:${c};`,
          "aria-label": `color ${c}`,
          onClick: () => {
            color.value = c
          },
        }),
      ),
    ),
    active !== "highlight"
      ? h(
          "div",
          { class: "ft-tool-group ft-stroke" },
          STROKE_WIDTHS.map((w) =>
            h(
              "button",
              {
                type: "button",
                class: `ft-stroke-dot ${activeStroke === w ? "active" : ""}`,
                "aria-label": `stroke ${w}`,
                onClick: () => {
                  strokeW.value = w
                },
              },
              h("span", {
                style: `width:${w * 2}px;height:${w * 2}px;background:currentColor;border-radius:50%;display:inline-block;`,
              }),
            ),
          ),
        )
      : null,
    h(
      "div",
      { class: "ft-tool-group" },
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Undo",
          title: "Undo (⌘Z)",
          disabled: !canUndo.value,
          onClick: undo,
        },
        "↶",
      ),
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Redo",
          title: "Redo (⌘⇧Z)",
          disabled: !canRedo.value,
          onClick: redo,
        },
        "↷",
      ),
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Clear all",
          title: "Clear",
          onClick: () => {
            if (confirm("Clear all annotations?")) clear()
          },
        },
        "🗑",
      ),
    ),
  )
}
