/**
 * Transport shape for user-supplied additional attachments. Lives in
 * sdk-utils because both packages/ui and packages/expo build this same
 * shape from their respective file pickers and hand it to their intake
 * clients. The dashboard's AttachmentDTO is a separate, render-side shape.
 */
export interface Attachment {
  /** Local UUID — used as React/Preact key and for picker dedupe. */
  id: string
  /** Raw file bytes. In Expo this is wrapped via fetch(uri).blob() before send. */
  blob: Blob
  /** Original filename, sanitized client-side. Server is the source of truth. */
  filename: string
  /** MIME type. Falls back to "application/octet-stream" if the picker doesn't supply one. */
  mime: string
  /** Bytes. */
  size: number
  /** Convenience: mime.startsWith("image/"). Set at construction. */
  isImage: boolean
  /** Object URL for thumbnail preview. Caller manages revocation. */
  previewUrl?: string
}

export interface AttachmentLimits {
  maxCount: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxCount: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
}

/**
 * Client-side mime denylist. Mirrors (but does not replace) the
 * server-side denylist. Server is authoritative.
 */
export const DENIED_MIME_PREFIXES: readonly string[] = [
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-executable",
] as const

export const DENIED_FILENAME_EXTENSIONS: readonly string[] = [
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".sh",
  ".ps1",
  ".vbs",
] as const
