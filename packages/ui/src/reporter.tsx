// packages/ui/src/reporter.tsx
import { h } from "preact"
import { useEffect, useState } from "preact/hooks"
import { reset } from "./annotation/store"
import { StepAnnotate } from "./wizard/step-annotate"
import { StepDescribe } from "./wizard/step-describe"

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

export function Reporter({ onClose, onCapture, onSubmit, openedAt }: ReporterProps) {
  const [bg, setBg] = useState<HTMLImageElement | null>(null)
  const [annotatedBlob, setAnnotatedBlob] = useState<Blob | null>(null)
  const [step, setStep] = useState<"annotate" | "describe">("annotate")
  const [rawScreenshot, setRawScreenshot] = useState<Blob | null>(null)
  const [captureFailed, setCaptureFailed] = useState(false)

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
        setCaptureFailed(true)
        return
      }
      setRawScreenshot(blob)
      url = URL.createObjectURL(blob)
      const img = new Image()
      // Revoke once the <img> has the bytes in memory (or has given up) so
      // the blob is freed eagerly. The cleanup below is a safety net for
      // the wizard-cancelled-mid-load path.
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

  function handleCancel() {
    onClose()
  }

  function handleNext(blob: Blob) {
    setAnnotatedBlob(blob)
    setStep("describe")
  }

  function handleSkip() {
    setAnnotatedBlob(rawScreenshot)
    setStep("describe")
  }

  function handleBack() {
    setStep("annotate")
  }

  async function handleSubmit(payload: {
    title: string
    description: string
    dwellMs: number
    honeypot: string
  }) {
    const result = await onSubmit({ ...payload, screenshot: annotatedBlob })
    if (result.ok) {
      setTimeout(onClose, 1500)
    }
    return result
  }

  if (captureFailed) {
    return h(StepDescribe, {
      annotatedBlob: null,
      onBack: handleCancel,
      onCancel: handleCancel,
      openedAt,
      onSubmit: async ({ title, description, dwellMs, honeypot }) =>
        handleSubmit({ title, description, dwellMs, honeypot }),
    })
  }

  if (!bg) {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (step === "annotate") {
    return h(StepAnnotate, {
      bg,
      onSkip: handleSkip,
      onNext: handleNext,
      onCancel: handleCancel,
    })
  }

  return h(StepDescribe, {
    annotatedBlob,
    onBack: handleBack,
    onCancel: handleCancel,
    openedAt,
    onSubmit: async ({ title, description, dwellMs, honeypot }) =>
      handleSubmit({ title, description, dwellMs, honeypot }),
  })
}
