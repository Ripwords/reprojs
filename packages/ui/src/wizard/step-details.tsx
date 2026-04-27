import { h } from "preact"
import { FieldLabel } from "./controls"

interface Props {
  title: string
  description: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
}

export function StepDetails({ title, description, onTitleChange, onDescriptionChange }: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner" },
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Title" }),
        h("input", {
          type: "text",
          value: title,
          maxLength: 120,
          placeholder: "What went wrong?",
          onInput: (e: Event) => onTitleChange((e.target as HTMLInputElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Details", optional: true }),
        h("textarea", {
          value: description,
          maxLength: 10000,
          rows: 6,
          placeholder: "Steps to reproduce, expected vs actual…",
          onInput: (e: Event) => onDescriptionChange((e.target as HTMLTextAreaElement).value),
        }),
      ),
    ),
  )
}
