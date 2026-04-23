import { RingBuffer } from "@reprojs/sdk-utils"

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug"
  ts: number
  args: string[]
  stack?: string
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const
const SENTINEL = "__reprojs_patched"

function stringifyArg(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export interface ConsoleCollector {
  start: () => void
  stop: () => void
  snapshot: () => ConsoleEntry[]
  clear: () => void
}

export function createConsoleCollector(opts: { max: number }): ConsoleCollector {
  const buf = new RingBuffer<ConsoleEntry>(opts.max)
  const originals: Partial<Record<(typeof LEVELS)[number], (...args: unknown[]) => void>> = {}
  let started = false

  function start() {
    if (started) return
    started = true
    for (const level of LEVELS) {
      const existing = console[level] as ((...args: unknown[]) => void) & {
        [SENTINEL]?: boolean
      }
      if (existing?.[SENTINEL]) continue
      originals[level] = existing
      const wrapped = ((...args: unknown[]) => {
        try {
          buf.push({
            level,
            ts: Date.now(),
            args: args.map(stringifyArg),
            stack:
              level === "warn" || level === "error"
                ? new Error().stack?.split("\n").slice(2).join("\n")
                : undefined,
          })
        } catch {
          // fail-open
        }
        existing.apply(console, args)
      }) as ((...args: unknown[]) => void) & { [SENTINEL]?: boolean }
      wrapped[SENTINEL] = true
      console[level] = wrapped as (typeof console)[typeof level]
    }
  }

  function stop() {
    if (!started) return
    started = false
    for (const level of LEVELS) {
      const original = originals[level]
      if (original) {
        console[level] = original as (typeof console)[typeof level]
      }
    }
  }

  return {
    start,
    stop,
    snapshot: () => buf.peek(),
    clear: () => buf.clear(),
    // Test-only access to the underlying buffer for fail-open test:
    __buf: buf,
  } as ConsoleCollector & { __buf: RingBuffer<ConsoleEntry> }
}
