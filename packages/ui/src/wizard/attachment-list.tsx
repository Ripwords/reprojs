import { h } from "preact"
import { useEffect, useRef } from "preact/hooks"
import type { Attachment, AttachmentLimits } from "@reprojs/sdk-utils"

interface Props {
  attachments: Attachment[]
  limits: AttachmentLimits
  errors?: string[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentList({ attachments, limits, errors, onAdd, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalBytes = attachments.reduce((n, a) => n + a.size, 0)
  const atCap = attachments.length >= limits.maxCount

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    }
  }, [])

  function openPicker() {
    fileInputRef.current?.click()
  }

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement
    const files = target.files ? Array.from(target.files) : []
    if (files.length > 0) onAdd(files)
    target.value = ""
  }

  return h(
    "div",
    { class: "ft-attach" },
    attachments.length > 0
      ? h(
          "div",
          { class: "ft-attach-grid" },
          ...attachments.map((a) =>
            h(
              "div",
              { class: "ft-attach-item", key: a.id },
              h(
                "button",
                {
                  type: "button",
                  class: "ft-attach-remove",
                  onClick: () => onRemove(a.id),
                  "aria-label": `Remove ${a.filename}`,
                },
                "✕",
              ),
              a.isImage && a.previewUrl
                ? h("img", { class: "ft-attach-thumb", src: a.previewUrl, alt: a.filename })
                : h("div", { class: "ft-attach-icon" }, "📄"),
              h("div", { class: "ft-attach-name", title: a.filename }, a.filename),
              h("div", { class: "ft-attach-meta" }, formatBytes(a.size)),
            ),
          ),
        )
      : null,
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
      h(
        "button",
        {
          type: "button",
          class: "ft-attach-add",
          disabled: atCap,
          onClick: openPicker,
        },
        atCap ? `${attachments.length} of ${limits.maxCount}` : "+ Add files",
      ),
      h(
        "div",
        { class: "ft-attach-status" },
        `${attachments.length} / ${limits.maxCount} · ${formatBytes(totalBytes)}`,
      ),
    ),
    h("input", {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: handleChange,
    }),
    errors && errors.length > 0
      ? h("div", { class: "ft-attach-error" }, ...errors.map((m) => h("div", { key: m }, m)))
      : null,
  )
}
