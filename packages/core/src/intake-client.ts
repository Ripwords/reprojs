import type { IntakeResponse, LogsAttachment, ReportContext } from "@reprokit/shared"
import type { ResolvedConfig } from "./config"

export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
  logs?: LogsAttachment | null
  /** Raw gzipped replay bytes (application/gzip); omitted when replay disabled or unavailable. */
  replayBytes?: Uint8Array | null
  dwellMs?: number
  honeypot?: string
}

export interface IntakeResult {
  ok: true
  id: string
  replayDisabled: boolean
}

export interface IntakeError {
  ok: false
  status: number
  message: string
}

export async function postReport(
  config: ResolvedConfig,
  input: IntakeInput,
): Promise<IntakeResult | IntakeError> {
  const body = new FormData()
  body.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: config.projectKey,
          title: input.title,
          description: input.description,
          context: input.context,
          ...(input.metadata ? { metadata: input.metadata } : {}),
          ...(input.dwellMs !== undefined ? { _dwellMs: input.dwellMs } : {}),
          ...(input.honeypot !== undefined ? { _hp: input.honeypot } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )
  if (input.screenshot) body.set("screenshot", input.screenshot, "screenshot.png")
  if (input.logs) {
    body.set(
      "logs",
      new Blob([JSON.stringify(input.logs)], { type: "application/json" }),
      "logs.json",
    )
  }
  if (input.replayBytes && input.replayBytes.length > 0) {
    // Copy into a fresh ArrayBuffer so the Blob part is typed as Uint8Array<ArrayBuffer>
    // regardless of the source buffer (ArrayBuffer | SharedArrayBuffer).
    const copy = new Uint8Array(input.replayBytes.byteLength)
    copy.set(input.replayBytes)
    body.set("replay", new Blob([copy], { type: "application/gzip" }), "replay.json.gz")
  }

  try {
    const res = await fetch(`${config.endpoint}/api/intake/reports`, {
      method: "POST",
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as IntakeResponse
      return { ok: true, id: data.id, replayDisabled: Boolean(data.replayDisabled) }
    }
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { statusMessage?: string; message?: string }
      message = data.statusMessage ?? data.message ?? message
    } catch {
      // non-JSON error — keep HTTP status
    }
    return { ok: false, status: res.status, message }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
}
