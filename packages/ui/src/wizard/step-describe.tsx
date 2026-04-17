// packages/ui/src/wizard/step-describe.tsx
import { h } from "preact"
import { useState } from "preact/hooks"
import type { ReporterSubmitResult } from "../reporter"

interface Props {
  annotatedBlob: Blob | null
  onBack: () => void
  onCancel: () => void
  onSubmit: (payload: { title: string; description: string }) => Promise<ReporterSubmitResult>
}

export function StepDescribe({ annotatedBlob, onBack, onCancel, onSubmit }: Props) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const previewUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : null

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({ title: title.trim(), description: description.trim() })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
    } else {
      setError(res.message ?? "Something went wrong.")
    }
  }

  return h(
    "div",
    { class: "ft-wizard" },
    h(
      "header",
      { class: "ft-wizard-header" },
      h(
        "button",
        { type: "button", class: "ft-back", onClick: onBack, disabled: submitting },
        "← Back",
      ),
      h("h2", null, "Describe"),
      h(
        "button",
        { type: "button", class: "ft-close", onClick: onCancel, "aria-label": "Close" },
        "✕",
      ),
    ),
    h(
      "form",
      { class: "ft-wizard-body ft-wizard-describe", onSubmit: handleSubmit },
      h(
        "div",
        { class: "ft-preview-wrap" },
        previewUrl
          ? h(
              "a",
              { href: previewUrl, target: "_blank", rel: "noopener" },
              h("img", {
                src: previewUrl,
                alt: "annotated screenshot",
                class: "ft-preview-full",
              }),
            )
          : h("div", { class: "ft-preview-placeholder" }, "No screenshot"),
      ),
      h(
        "div",
        { class: "ft-form" },
        h(
          "label",
          { class: "ft-field" },
          h("span", null, "Title"),
          h("input", {
            value: title,
            onInput: (e: Event) => setTitle((e.target as HTMLInputElement).value),
            maxLength: 120,
            required: true,
            disabled: submitting || success,
          }),
        ),
        h(
          "label",
          { class: "ft-field" },
          h("span", null, "What happened?"),
          h("textarea", {
            value: description,
            onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
            maxLength: 10000,
            rows: 6,
            disabled: submitting || success,
          }),
        ),
        error ? h("div", { class: "ft-msg err" }, error) : null,
        success ? h("div", { class: "ft-msg ok" }, "Thanks! Report sent.") : null,
        h(
          "div",
          { class: "ft-actions" },
          h(
            "button",
            {
              type: "button",
              class: "ft-btn",
              onClick: onCancel,
              disabled: submitting,
            },
            "Cancel",
          ),
          h(
            "button",
            {
              type: "submit",
              class: "ft-btn primary",
              disabled: submitting || success || !title.trim(),
            },
            submitting ? "Sending…" : "Send report",
          ),
        ),
      ),
    ),
  )
}
