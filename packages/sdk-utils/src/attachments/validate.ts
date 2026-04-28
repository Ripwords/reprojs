import {
  DENIED_FILENAME_EXTENSIONS,
  DENIED_MIME_PREFIXES,
  type Attachment,
  type AttachmentCandidate,
  type AttachmentLimits,
} from "./types"

export type ValidationFailureReason =
  | "too-large"
  | "denied-mime"
  | "count-exceeded"
  | "total-exceeded"
  | "unreadable"

export interface ValidationFailure {
  filename: string
  reason: ValidationFailureReason
}

export interface ValidationResult {
  accepted: Attachment[]
  rejected: ValidationFailure[]
}

function isDenied(filename: string, mime: string): boolean {
  if (DENIED_MIME_PREFIXES.some((p) => mime === p || mime.startsWith(`${p}/`))) return true
  const lower = filename.toLowerCase()
  return DENIED_FILENAME_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function validateAttachments(
  candidates: AttachmentCandidate[],
  existing: Attachment[],
  limits: AttachmentLimits,
): ValidationResult {
  const accepted: Attachment[] = []
  const rejected: ValidationFailure[] = []

  let runningCount = existing.length
  let runningTotal = existing.reduce((n, a) => n + a.size, 0)

  for (const file of candidates) {
    const filename = file.name
    const mime = file.type || "application/octet-stream"

    if (file.size === 0) {
      rejected.push({ filename, reason: "unreadable" })
      continue
    }
    if (isDenied(filename, mime)) {
      rejected.push({ filename, reason: "denied-mime" })
      continue
    }
    if (file.size > limits.maxFileBytes) {
      rejected.push({ filename, reason: "too-large" })
      continue
    }
    if (runningCount + 1 > limits.maxCount) {
      rejected.push({ filename, reason: "count-exceeded" })
      continue
    }
    if (runningTotal + file.size > limits.maxTotalBytes) {
      rejected.push({ filename, reason: "total-exceeded" })
      continue
    }

    accepted.push({
      id: newId(),
      // Web's File satisfies AttachmentCandidate AND extends Blob, so the
      // direct cast is correct on the web side. Expo passes a plain object
      // and reattaches the real blob/previewUrl in the caller — for
      // validation we only need the metadata fields.
      blob: file.blob ?? (file as unknown as Blob),
      filename,
      mime,
      size: file.size,
      isImage: mime.startsWith("image/"),
    })
    runningCount += 1
    runningTotal += file.size
  }

  return { accepted, rejected }
}
