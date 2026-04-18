const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 3_600_000] as const

export function computeBackoff(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_MS.length - 1))
  return BACKOFF_MS[idx]
}
