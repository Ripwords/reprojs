import { h } from "preact"

export interface SummaryLine {
  label: string
  hint?: string
}

interface Props {
  summary: SummaryLine[]
  error: string | null
}

export function StepReview({ summary, error }: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner" },
      h(
        "div",
        { class: "ft-summary" },
        h("div", { class: "ft-summary-title" }, "Included in this report"),
        ...summary.map((line) =>
          h(
            "div",
            { class: "ft-summary-row", key: line.label },
            h("div", { class: "ft-summary-bullet" }),
            h("div", { class: "ft-summary-label" }, line.label),
            line.hint ? h("div", { class: "ft-summary-hint" }, line.hint) : null,
          ),
        ),
      ),
      error ? h("div", { class: "ft-error-card" }, error) : null,
    ),
  )
}
