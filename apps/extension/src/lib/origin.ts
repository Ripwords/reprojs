import type { Config } from "../types"

const INJECTABLE = new Set(["http:", "https:"])

export function toOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    if (!INJECTABLE.has(u.protocol)) return null
    return u.origin
  } catch {
    return null
  }
}

export function findConfigForUrl(url: string, configs: readonly Config[]): Config | undefined {
  const origin = toOrigin(url)
  if (origin === null) return undefined
  return configs.find((c) => c.origin === origin)
}
