// packages/ui/src/wizard/step-annotate.tsx
import { h } from "preact"
import { useEffect } from "preact/hooks"
import { Canvas } from "../annotation/canvas"
import { flatten } from "../annotation/flatten"
import { DEFAULT_SHORTCUTS, registerShortcuts, type Action } from "../annotation/shortcuts"
import { clear, redo, shapes, tool, undo, viewport } from "../annotation/store"
import { ToolPicker } from "../annotation/tool-picker"
import type { Tool } from "@reprojs/sdk-utils"
import { fitTransform } from "../annotation/viewport"

interface Props {
  bg: HTMLImageElement
  onSkip: () => void
  onNext: (annotatedBlob: Blob) => void
  onCancel: () => void
}

export function StepAnnotate({ bg, onSkip, onNext, onCancel }: Props) {
  useEffect(() => {
    const dispatch = (action: Action) => {
      switch (action) {
        case "tool.arrow":
        case "tool.rect":
        case "tool.pen":
        case "tool.highlight":
        case "tool.text":
          tool.value = action.split(".")[1] as Tool
          return
        case "undo":
          undo()
          return
        case "redo":
          redo()
          return
        case "clear":
          if (shapes.value.length > 0 && confirm("Clear all annotations?")) clear()
          return
        case "cancel.draft":
          return
        case "resetView": {
          const w = (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width
          const hh = (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height
          viewport.value = fitTransform(w, hh, window.innerWidth, window.innerHeight)
          return
        }
      }
    }
    const dispose = registerShortcuts(window, DEFAULT_SHORTCUTS, dispatch)
    return () => dispose()
  }, [bg])

  async function handleNext() {
    const blob = await flatten(bg, shapes.value)
    onNext(blob)
  }

  function handleClose() {
    if (shapes.value.length > 0 && !confirm("Discard annotations?")) return
    onCancel()
  }

  return h(
    "div",
    { class: "ft-wizard" },
    h(
      "header",
      { class: "ft-wizard-header" },
      h("h2", null, "Report a bug"),
      h(
        "button",
        { type: "button", class: "ft-close", onClick: handleClose, "aria-label": "Close" },
        "✕",
      ),
    ),
    h("div", { class: "ft-wizard-body ft-wizard-annotate" }, h(Canvas, { bg })),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(ToolPicker, null),
      h(
        "div",
        { class: "ft-wizard-next" },
        h("button", { type: "button", class: "ft-btn", onClick: onSkip }, "Skip"),
        h("button", { type: "button", class: "ft-btn primary", onClick: handleNext }, "Next →"),
      ),
    ),
  )
}
