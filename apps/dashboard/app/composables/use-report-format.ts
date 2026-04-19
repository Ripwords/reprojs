/**
 * Shared display helpers for reports — previously duplicated across the
 * projects overview, inbox list, and report-detail page, each with subtle
 * inconsistencies in granularity (hour-only on overview, minute+hour+day on
 * the others). Centralize here so updates land in one place.
 */

export type ReportBadgeColor = "error" | "warning" | "primary" | "neutral"

/**
 * Map a report priority to a semantic badge color. Undefined / unknown
 * priorities fall back to "neutral" so the call sites can pass `report.priority`
 * directly without an extra guard.
 */
export function priorityColor(p: string | undefined | null): ReportBadgeColor {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}

/**
 * Humanize an ISO timestamp into the compact scheme we use across the app.
 * Handles undefined / empty input so the caller can pass optional fields
 * directly.
 *
 * Default (`compact: false`): "just now" | "5m ago" | "3h ago" | "2d ago"
 * Compact (`compact: true`):  "now" | "5m" | "3h" | "2d"  — for dense table
 *                             columns where "ago" would steal column width.
 */
export function relativeTime(
  iso: string | undefined | null,
  opts: { compact?: boolean } = {},
): string {
  if (!iso) return ""
  const suffix = opts.compact ? "" : " ago"
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return opts.compact ? "now" : "just now"
  if (mins < 60) return `${mins}m${suffix}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h${suffix}`
  const days = Math.floor(hrs / 24)
  return `${days}d${suffix}`
}
