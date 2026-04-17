import { RingBuffer } from "./ring-buffer"
import { serializeArg } from "./serialize"

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug"

export interface ConsoleEntry {
  level: ConsoleLevel
  ts: number
  args: string[]
  stack?: string
}

export interface ConsoleConfig {
  maxEntries?: number
  maxArgBytes?: number
  maxEntryBytes?: number
  enabled?: boolean
  stringRedactors?: RegExp[]
}

export interface ConsoleCollector {
  start(config: ConsoleConfig): void
  snapshot(): ConsoleEntry[]
  stop(): void
}

const METHODS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"]

export function createConsoleCollector(_initial: ConsoleConfig): ConsoleCollector {
  let buffer: RingBuffer<ConsoleEntry> | null = null
  const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {}
  let running = false
  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      const maxArg = config.maxArgBytes ?? 1024
      const redactors = config.stringRedactors ?? []
      buffer = new RingBuffer<ConsoleEntry>(config.maxEntries ?? 100)
      for (const level of METHODS) {
        // Store the original unbound reference to restore it exactly
        originals[level] = console[level]
        const orig = console[level].bind(console)
        console[level] = (...args: unknown[]) => {
          try {
            const serialized = args.map((a) => serializeArg(a, maxArg, redactors))
            const entry: ConsoleEntry = {
              level,
              ts: Date.now(),
              args: serialized,
            }
            if (level === "warn" || level === "error") {
              entry.stack = new Error("trace").stack ?? undefined
            }
            buffer?.push(entry)
          } catch {
            // Never let collector throw into host code
          }
          orig(...args)
        }
      }
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    stop() {
      if (!running) return
      for (const level of METHODS) {
        const o = originals[level]
        if (o) console[level] = o
      }
      for (const key of Object.keys(originals) as ConsoleLevel[]) delete originals[key]
      buffer = null
      running = false
    },
  }
}
