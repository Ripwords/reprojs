const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 3_600_000] as const

export function computeBackoff(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_MS.length - 1))
  return BACKOFF_MS[idx]
}

export interface LabelsForReport {
  priority: "low" | "normal" | "high" | "urgent"
  tags: readonly string[]
}

export interface LabelsForIntegration {
  defaultLabels: readonly string[]
}

export function labelsFor(report: LabelsForReport, integration: LabelsForIntegration): string[] {
  const seen = new Set<string>()
  const add = (s: string) => {
    if (!seen.has(s)) seen.add(s)
  }
  for (const l of integration.defaultLabels) add(l)
  add(`priority:${report.priority}`)
  for (const t of report.tags) add(t)
  return [...seen].sort()
}
