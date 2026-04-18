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
  return [...seen].toSorted()
}

export interface BuildIssueBodyInput {
  id: string
  title: string
  description: string
  pageUrl: string
  reporterEmail: string | null
  createdAt: Date
  screenshotUrl: string | null
  dashboardUrl: string
}

function fmtUtc(d: Date): string {
  const iso = d.toISOString()
  return `${iso.slice(0, 16).replace("T", " ")} UTC`
}

export function buildIssueBody(input: BuildIssueBodyInput): string {
  const lines: string[] = []
  const reporter = input.reporterEmail ? `**${input.reporterEmail}**` : "anonymous"
  lines.push(`> Reported by ${reporter} via Feedback Tool`)
  if (input.pageUrl) lines.push(`> Page: ${input.pageUrl}`)
  lines.push(`> Captured: ${fmtUtc(input.createdAt)}`)
  lines.push("")
  lines.push("## Description")
  lines.push("")
  lines.push(input.description)
  if (input.screenshotUrl) {
    lines.push("")
    lines.push(`![Screenshot](${input.screenshotUrl})`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push(`<sub>Full context (console, network, cookies, replay): ${input.dashboardUrl}</sub>`)
  return lines.join("\n")
}
