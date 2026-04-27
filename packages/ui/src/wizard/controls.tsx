import { h, type ComponentChildren } from "preact"

interface PrimaryButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
}

export function PrimaryButton({ label, onClick, disabled, loading }: PrimaryButtonProps) {
  return h(
    "button",
    {
      type: "button",
      class: "ft-btn-primary",
      onClick,
      disabled: disabled || loading,
    },
    loading ? "Sending…" : label,
  )
}

interface SecondaryButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
}

export function SecondaryButton({ label, onClick, disabled }: SecondaryButtonProps) {
  return h("button", { type: "button", class: "ft-btn-secondary", onClick, disabled }, label)
}

interface FieldLabelProps {
  label: string
  optional?: boolean
}

export function FieldLabel({ label, optional }: FieldLabelProps) {
  return h(
    "div",
    { class: "ft-field-label" },
    label,
    optional ? h("span", { class: "ft-field-label-optional" }, "optional") : null,
  )
}

interface StepIndicatorProps {
  steps: readonly string[]
  current: number
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return h(
    "div",
    { class: "ft-stepper" },
    ...steps.flatMap((label, i) => {
      const active = i === current
      const done = i < current
      const dotClass = `ft-stepper-dot${active ? " active" : done ? " done" : ""}`
      const labelClass = `ft-stepper-label${active ? " active" : done ? " done" : ""}`
      const item = h(
        "div",
        { class: "ft-stepper-item", key: `item-${i}` },
        h("div", { class: dotClass }, String(i + 1)),
        h("div", { class: labelClass }, label),
      )
      if (i === steps.length - 1) return [item]
      const bar = h("div", {
        class: `ft-stepper-bar${done ? " done" : ""}`,
        key: `bar-${i}`,
      })
      return [item, bar]
    }),
  )
}

interface WizardHeaderProps {
  eyebrow: string
  title: string
  steps: readonly string[]
  current: number
  onClose: () => void
  leadingIcon?: ComponentChildren
}

export function WizardHeader({
  eyebrow,
  title,
  steps,
  current,
  onClose,
  leadingIcon,
}: WizardHeaderProps) {
  return h(
    "header",
    { class: "ft-wizard-header" },
    h("div", null, leadingIcon ?? null),
    h(
      "div",
      null,
      h("p", { class: "ft-wizard-eyebrow" }, eyebrow),
      h("h2", { class: "ft-wizard-title" }, title),
      h(StepIndicator, { steps, current }),
    ),
    h(
      "button",
      {
        type: "button",
        class: "ft-icon-btn",
        onClick: onClose,
        "aria-label": "Close",
      },
      "✕",
    ),
  )
}
