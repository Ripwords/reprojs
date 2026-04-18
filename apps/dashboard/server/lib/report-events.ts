import type { NewReportEvent, ReportEventKind } from "../db/schema"
import { diffTags } from "./inbox-query"

export interface BeforeAfter {
  status?: { from: string; to: string }
  priority?: { from: string; to: string }
  assigneeId?: { from: string | null; to: string | null }
  tags?: { from: string[]; to: string[] }
}

/**
 * Build the list of report_events rows for a single report mutation. Callers
 * pass the "before" and "after" values of each touched field; the helper emits
 * exactly one event per changed scalar field and one event per added/removed
 * tag. No events when a field's from === to.
 *
 * Pure — returns the list. Callers handle the INSERT inside their transaction.
 */
export function buildReportEvents(
  reportId: string,
  actorId: string,
  change: BeforeAfter,
): NewReportEvent[] {
  const events: NewReportEvent[] = []
  const push = (kind: ReportEventKind, payload: Record<string, unknown>) => {
    events.push({ reportId, actorId, kind, payload })
  }

  if (change.status && change.status.from !== change.status.to) {
    push("status_changed", { from: change.status.from, to: change.status.to })
  }
  if (change.priority && change.priority.from !== change.priority.to) {
    push("priority_changed", { from: change.priority.from, to: change.priority.to })
  }
  if (change.assigneeId && change.assigneeId.from !== change.assigneeId.to) {
    push("assignee_changed", { from: change.assigneeId.from, to: change.assigneeId.to })
  }
  if (change.tags) {
    const { added, removed } = diffTags(change.tags.from, change.tags.to)
    for (const name of added) push("tag_added", { name })
    for (const name of removed) push("tag_removed", { name })
  }
  return events
}
