import { h } from "preact"

interface Props {
  visible: boolean
  attachmentCount: number
}

/**
 * Inflight toast shown while the report is being uploaded. When the report
 * carries user attachments we hint that those are being scanned, since
 * server-side processing can run several seconds when a virus scan is
 * enabled — reassuring the user that the wizard hasn't frozen.
 *
 * The progress bar is intentionally indeterminate: we have no granular
 * progress signal from a single multipart POST, only "still in flight".
 */
export function SubmitToast({ visible, attachmentCount }: Props) {
  if (!visible) return null
  const message =
    attachmentCount > 0
      ? `Scanning ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} & sending report…`
      : "Sending report…"
  return h(
    "div",
    { class: "ft-toast", role: "status", "aria-live": "polite" },
    h(
      "div",
      { class: "ft-toast-row" },
      h("span", { class: "ft-toast-icon", "aria-hidden": "true" }, "🛡️"),
      h("span", null, message),
    ),
    h("div", { class: "ft-toast-progress", "aria-hidden": "true" }),
  )
}
