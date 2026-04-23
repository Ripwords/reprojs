import type { ReportIntakeInput, IntakeResponse } from "@reprojs/shared"
import type { QueueItemAttachment } from "./queue/storage"

export interface IntakeSubmitArgs {
  idempotencyKey: string
  input: ReportIntakeInput
  attachments: Array<QueueItemAttachment & { contentType: string }>
}

export class IntakeError extends Error {
  status: number
  retryable: boolean
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.retryable = status >= 500 || status === 429
  }
}

export interface IntakeClient {
  submit: (args: IntakeSubmitArgs) => Promise<IntakeResponse>
}

export function createIntakeClient(opts: {
  intakeUrl: string
  fetchImpl?: typeof fetch
}): IntakeClient {
  const f = opts.fetchImpl ?? fetch

  return {
    async submit({ idempotencyKey, input, attachments }) {
      const form = new FormData()
      form.append("report", new Blob([JSON.stringify(input)], { type: "application/json" }))
      for (const a of attachments) {
        // In RN, FormData accepts { uri, name, type } shorthand. We use it via a typed helper.
        const part = { uri: a.uri, name: `${a.kind}.bin`, type: a.contentType } as unknown as Blob
        form.append(a.kind, part)
      }
      const res = await f(`${opts.intakeUrl}/reports`, {
        method: "POST",
        body: form as unknown as BodyInit,
        headers: { "idempotency-key": idempotencyKey },
      })
      if (res.status >= 400) {
        const body = await res.text().catch(() => "")
        throw new IntakeError(res.status, body || res.statusText)
      }
      return (await res.json()) as IntakeResponse
    },
  }
}
