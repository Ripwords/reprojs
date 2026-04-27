import { h } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { reset, shapes } from "./annotation/store"
import { StepAnnotate } from "./wizard/step-annotate"
import { StepDetails } from "./wizard/step-details"
import { StepReview, type SummaryLine } from "./wizard/step-review"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./wizard/controls"

export interface ReporterSubmitResult {
  ok: boolean
  message?: string
}

interface ReporterProps {
  onClose: () => void
  onCapture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
}

const STEPS = ["Annotate", "Details", "Review"] as const
type StepName = "annotate" | "details" | "review"
const STEP_INDEX: Record<StepName, number> = { annotate: 0, details: 1, review: 2 }

export function Reporter({ onClose, onCapture, onSubmit, openedAt }: ReporterProps) {
  const [bg, setBg] = useState<HTMLImageElement | null>(null)
  const [annotatedBlob, setAnnotatedBlob] = useState<Blob | null>(null)
  const [rawScreenshot, setRawScreenshot] = useState<Blob | null>(null)
  const [step, setStep] = useState<StepName>("annotate")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const hpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let revoked = false
    let url: string | null = null
    const revokeOnce = () => {
      if (url) {
        URL.revokeObjectURL(url)
        url = null
      }
    }
    ;(async () => {
      const blob = await onCapture()
      if (!blob) {
        if (!revoked) onClose()
        return
      }
      setRawScreenshot(blob)
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.addEventListener("load", () => {
        if (!revoked) setBg(img)
        revokeOnce()
      })
      img.addEventListener("error", revokeOnce)
      img.src = url
    })()
    return () => {
      revoked = true
      revokeOnce()
      reset()
    }
  }, [])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  function handleNextFromAnnotate(blob: Blob) {
    setAnnotatedBlob(blob)
    setStep("details")
  }
  function handleSkipFromAnnotate() {
    setAnnotatedBlob(rawScreenshot)
    setStep("details")
  }
  function handleBack() {
    if (step === "review") setStep("details")
    else if (step === "details") setStep("annotate")
  }
  function handleContinueFromDetails() {
    setStep("review")
  }

  async function handleSend() {
    if (!title.trim() || submitting || success) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      screenshot: annotatedBlob,
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(onClose, 1500)
    } else {
      setSubmitError(res.message ?? "Something went wrong.")
    }
  }

  const summary = useMemo<SummaryLine[]>(() => {
    const lines: SummaryLine[] = [{ label: "Title & description" }]
    if (annotatedBlob) {
      lines.push({
        label: shapes.value.length > 0 ? "Annotated screenshot" : "Screenshot",
        hint: shapes.value.length > 0 ? String(shapes.value.length) : undefined,
      })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Environment info" })
    return lines
  }, [annotatedBlob])

  if (!bg) {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (step === "annotate") {
    return h(StepAnnotate, {
      bg,
      steps: STEPS,
      currentStep: STEP_INDEX.annotate,
      onSkip: handleSkipFromAnnotate,
      onNext: handleNextFromAnnotate,
      onCancel: onClose,
    })
  }

  const headerProps = {
    eyebrow: "Repro",
    title: "Report a bug",
    steps: STEPS,
    current: STEP_INDEX[step],
    onClose,
  }

  const body =
    step === "details"
      ? h(StepDetails, {
          title,
          description,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
        })
      : h(StepReview, { summary, error: success ? null : submitError })

  const primary =
    step === "details"
      ? h(PrimaryButton, {
          label: "Continue",
          onClick: handleContinueFromDetails,
          disabled: !title.trim(),
        })
      : h(PrimaryButton, {
          label: success ? "Sent" : "Send report",
          onClick: handleSend,
          disabled: !title.trim() || success,
          loading: submitting,
        })

  return h(
    "div",
    { class: "ft-wizard" },
    h(WizardHeader, headerProps),
    body,
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(SecondaryButton, { label: "Back", onClick: handleBack, disabled: submitting }),
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
      primary,
    ),
  )
}
