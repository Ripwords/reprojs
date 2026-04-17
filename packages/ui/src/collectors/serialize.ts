// packages/ui/src/collectors/serialize.ts

export const DEFAULT_STRING_REDACTORS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_.+/=-]*/g,
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /xox[abp]-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
]

export function scrubString(s: string, patterns: readonly RegExp[]): string {
  let out = s
  for (const re of patterns) out = out.replace(re, "REDACTED")
  return out
}

export function truncate(s: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  const buf = encoder.encode(s)
  if (buf.length <= maxBytes) return s
  let cut = maxBytes
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1
  const truncated = new TextDecoder().decode(buf.slice(0, cut))
  return `${truncated}… [truncated ${buf.length - cut}b]`
}

export function serializeArg(v: unknown, maxBytes: number, redactors: readonly RegExp[]): string {
  let raw: string
  try {
    raw = safeStringify(v)
  } catch {
    raw = "[Unserializable]"
  }
  return scrubString(truncate(raw, maxBytes), redactors)
}

function safeStringify(v: unknown): string {
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  if (typeof v === "function") return "[Function]"
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN"
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity"
    return String(v)
  }
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "boolean" || typeof v === "bigint") return String(v)
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`
  }
  if (ArrayBuffer.isView(v)) {
    const ta = v as unknown as { length: number; constructor: { name: string } }
    return `[${ta.constructor.name} length=${ta.length}]`
  }
  const seen = new WeakSet<object>()
  return JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    if (typeof value === "function") return "[Function]"
    if (typeof value === "bigint") return String(value)
    return value
  })
}
