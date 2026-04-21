import { useState } from "preact/hooks"
import type { ConfigInput } from "../types"

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

type Props = {
  onSubmit: (input: ConfigInput) => Promise<{ ok: true } | { ok: false; message: string }>
  onCancel?: () => void
  submitLabel?: string
  /** Pre-fills the intake endpoint field — typically the user's last saved value. */
  defaultIntakeEndpoint?: string
}

function validate(input: ConfigInput): string | null {
  if (input.label.trim().length === 0) return "Label is required."
  if (!KEY_RE.test(input.projectKey)) {
    return "Project key must match rp_pk_ followed by 24 letters or digits."
  }
  let originUrl: URL
  try {
    originUrl = new URL(input.origin)
  } catch {
    return "Origin must be a valid URL (e.g. https://staging.acme.com)."
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return "Origin must use http or https."
  }
  if (`${originUrl.origin}` !== input.origin) {
    return "Origin must be scheme + host (+ port) only, with no path."
  }
  try {
    // oxlint-disable-next-line no-new
    new URL(input.intakeEndpoint)
  } catch {
    return "Intake endpoint must be a valid absolute URL."
  }
  return null
}

export function AddConfigForm({
  onSubmit,
  onCancel,
  submitLabel = "Add origin",
  defaultIntakeEndpoint = "",
}: Props) {
  const [label, setLabel] = useState("")
  const [origin, setOrigin] = useState("")
  const [projectKey, setProjectKey] = useState("")
  // Lazy init so the prop value at mount time becomes the initial state;
  // subsequent re-renders won't clobber the user's edits. The form remounts
  // each time the user switches to Add mode, so a newly-saved last value
  // will show up on the next visit.
  const [intakeEndpoint, setIntakeEndpoint] = useState(() => defaultIntakeEndpoint)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    const input: ConfigInput = {
      label: label.trim(),
      origin: origin.trim(),
      projectKey: projectKey.trim(),
      intakeEndpoint: intakeEndpoint.trim(),
    }
    const err = validate(input)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await onSubmit(input)
    setSubmitting(false)
    if (result.ok) {
      setLabel("")
      setOrigin("")
      setProjectKey("")
      // Preserve the intake endpoint so a tester adding several configs in a
      // row on the options page doesn't retype their dashboard URL each time.
      setIntakeEndpoint(input.intakeEndpoint)
    } else {
      setError(result.message)
    }
  }

  return (
    <form class="form" onSubmit={handleSubmit} noValidate>
      <div class="hint-bar">
        After saving, Chrome will ask for permission on the site origin and the intake endpoint. If
        the popup closes mid-prompt, your config is already saved — you can <strong>Grant</strong>{" "}
        it from the list.
      </div>

      <div class="field">
        <label for="label">Label</label>
        <input
          id="label"
          value={label}
          placeholder="staging"
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <label for="origin">Origin</label>
        <input
          id="origin"
          placeholder="https://staging.acme.com"
          value={origin}
          spellcheck={false}
          onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
        />
        <div class="field-hint">scheme + host + optional port — no path</div>
      </div>

      <div class="field">
        <label for="projectKey">Project key</label>
        <input
          id="projectKey"
          placeholder="rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx"
          value={projectKey}
          spellcheck={false}
          onInput={(e) => setProjectKey((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <label for="intakeEndpoint">Intake endpoint</label>
        <input
          id="intakeEndpoint"
          placeholder="https://feedback.example.com"
          value={intakeEndpoint}
          spellcheck={false}
          onInput={(e) => setIntakeEndpoint((e.target as HTMLInputElement).value)}
        />
        <div class="field-hint">the dashboard URL — SDK posts to this host</div>
      </div>

      {error ? <div class="error-bar">{error}</div> : null}

      <div class="form-actions">
        {onCancel ? (
          <button type="button" class="btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        ) : null}
        <button type="submit" class="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  )
}
