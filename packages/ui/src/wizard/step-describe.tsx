// packages/ui/src/wizard/step-describe.tsx
import { h } from "preact"
import { useRef, useState } from "preact/hooks"
import type { ReporterSubmitResult } from "../reporter"

interface Props {
  annotatedBlob: Blob | null
  onBack: () => void
  onCancel: () => void
  openedAt: number
  onSubmit: (payload: {
    title: string
    description: string
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
}

export function StepDescribe({ annotatedBlob, onBack, onCancel, openedAt, onSubmit }: Props) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const hpRef = useRef<HTMLInputElement>(null)

  const previewUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : null

  async function handleSubmit(e?: Event) {
    // Belt + suspenders: stop any native form submission. The form below has no
    // action/method set, but without preventDefault the browser will navigate
    // to the current URL on submit — which tears down the SDK, the shadow DOM,
    // and every collector buffer along with it.
    e?.preventDefault()
    if (!title.trim() || submitting || success) return
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
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
      // Deliberately a <div>, not a <form>. A <form> in the describe step has
      // caused a full-page navigation-to-current-URL on submit — Preact's
      // onSubmit binding inside an open Shadow DOM does not reliably prevent
      // the browser's default submission, and implicit Enter-to-submit in the
      // title <input> takes the same path. Navigation tears down the shadow
      // host, the mount root, and every collector ring buffer (console,
      // network, breadcrumbs), which means the very logs we're trying to
      // submit get wiped milliseconds before snapshotAll() runs.
      "div",
      { class: "ft-wizard-body ft-wizard-describe" },
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
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void handleSubmit()
              }
            },
            maxLength: 120,
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
        h("input", {
          ref: hpRef,
          name: "website",
          type: "text",
          tabIndex: -1,
          autoComplete: "off",
          "aria-hidden": "true",
          style: {
            position: "absolute",
            left: "-9999px",
            top: "-9999px",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          },
        }),
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
              type: "button",
              class: "ft-btn primary",
              onClick: () => {
                void handleSubmit()
              },
              disabled: submitting || success || !title.trim(),
            },
            submitting ? "Sending…" : "Send report",
          ),
        ),
      ),
    ),
  )
}
