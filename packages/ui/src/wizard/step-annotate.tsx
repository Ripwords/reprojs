import { h } from "preact"
import { useEffect } from "preact/hooks"
import { Canvas } from "../annotation/canvas"
import { flatten } from "../annotation/flatten"
import { DEFAULT_SHORTCUTS, registerShortcuts, type Action } from "../annotation/shortcuts"
import { clear, redo, shapes, tool, undo, viewport } from "../annotation/store"
import { ToolPicker } from "../annotation/tool-picker"
import type { Tool } from "@reprojs/sdk-utils"
import { fitTransform } from "../annotation/viewport"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./controls"

interface Props {
  bg: HTMLImageElement
  steps: readonly string[]
  currentStep: number
  onSkip: () => void
  onNext: (annotatedBlob: Blob) => void
  onCancel: () => void
}

export function StepAnnotate({ bg, steps, currentStep, onSkip, onNext, onCancel }: Props) {
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
    h(WizardHeader, {
      eyebrow: "Repro",
      title: "Report a bug",
      steps,
      current: currentStep,
      onClose: handleClose,
    }),
    h("div", { class: "ft-wizard-body ft-wizard-annotate" }, h(Canvas, { bg })),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(ToolPicker, null),
      h(
        "div",
        { style: { display: "flex", gap: "8px" } },
        h(SecondaryButton, { label: "Skip", onClick: onSkip }),
        h(PrimaryButton, { label: "Continue", onClick: handleNext }),
      ),
    ),
  )
}
