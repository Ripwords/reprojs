import { useState } from "preact/hooks"
import type { ConfigInput } from "../types"

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

type Props = {
  onSubmit: (input: ConfigInput) => Promise<{ ok: true } | { ok: false; message: string }>
}

function validate(input: ConfigInput): string | null {
  if (input.label.trim().length === 0) return "Label is required."
  if (!KEY_RE.test(input.projectKey)) return "projectKey must match rp_pk_[24 chars]."
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

export function AddConfigForm({ onSubmit }: Props) {
  const [label, setLabel] = useState("")
  const [origin, setOrigin] = useState("")
  const [projectKey, setProjectKey] = useState("")
  const [intakeEndpoint, setIntakeEndpoint] = useState("")
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
      setIntakeEndpoint("")
    } else {
      setError(result.message)
    }
  }

  return (
    <form class="form" onSubmit={handleSubmit}>
      <div class="field">
        <label for="label">Label</label>
        <input
          id="label"
          value={label}
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for="origin">Origin</label>
        <input
          id="origin"
          placeholder="https://staging.acme.com"
          value={origin}
          onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for="projectKey">Project key</label>
        <input
          id="projectKey"
          value={projectKey}
          onInput={(e) => setProjectKey((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for="intakeEndpoint">Intake endpoint</label>
        <input
          id="intakeEndpoint"
          placeholder="https://repro.example.com"
          value={intakeEndpoint}
          onInput={(e) => setIntakeEndpoint((e.target as HTMLInputElement).value)}
        />
      </div>
      {error ? <div class="error">{error}</div> : null}
      <button type="submit" class="btn primary" disabled={submitting}>
        {submitting ? "Requesting permission…" : "Add origin"}
      </button>
    </form>
  )
}
