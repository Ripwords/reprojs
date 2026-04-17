import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

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
  }) => Promise<ReporterSubmitResult>
}

export function Reporter({ onClose, onCapture, onSubmit }: ReporterProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [screenshot, setScreenshot] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    ;(async () => {
      const blob = await onCapture()
      setScreenshot(blob)
      if (blob) setPreviewUrl(URL.createObjectURL(blob))
    })()
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [])

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      screenshot,
    })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(onClose, 1500)
    } else {
      setError(res.message ?? "Something went wrong, please try again.")
    }
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div class="ft-overlay" onClick={handleBackdrop}>
      <form class="ft-modal" onSubmit={handleSubmit} aria-labelledby="ft-title">
        <h2 id="ft-title">Report a bug</h2>
        <label class="ft-field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            required
            maxLength={120}
            disabled={submitting || success}
          />
        </label>
        <label class="ft-field">
          <span>What happened?</span>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            maxLength={10000}
            disabled={submitting || success}
          />
        </label>
        <div class="ft-field">
          <span>Screenshot</span>
          {previewUrl ? (
            <img class="ft-preview" src={previewUrl} alt="screenshot preview" />
          ) : (
            <div class="ft-preview empty">
              {screenshot === null ? "Capturing…" : "Screenshot unavailable"}
            </div>
          )}
        </div>
        {error && <div class="ft-msg err">{error}</div>}
        {success && <div class="ft-msg ok">Thanks! Report sent.</div>}
        <div class="ft-actions">
          <button type="button" class="ft-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            class="ft-btn primary"
            disabled={submitting || success || !title.trim()}
          >
            {submitting ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </div>
  )
}
