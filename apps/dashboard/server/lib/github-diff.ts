// apps/dashboard/server/lib/github-diff.ts
// Canonical signature helpers for write-lock fingerprinting.
// Every outbound GitHub write records a signature before execution.
// The matching inbound webhook consumes the lock — if found, it's an echo
// from our own write and should be skipped.
import { createHash } from "node:crypto"

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

/** Canonical signature for a label set. Sort-invariant. */
export function signLabels(labels: string[]): string {
  const sorted = labels.toSorted()
  return sha256(`labels:${sorted.join(",")}`)
}

/** Canonical signature for an assignee set. Sort-invariant. */
export function signAssignees(logins: string[]): string {
  const sorted = logins.toSorted()
  return sha256(`assignees:${sorted.join(",")}`)
}

/** Canonical signature for a milestone. null → distinct from any numbered milestone. */
export function signMilestone(milestoneNumber: number | null): string {
  return sha256(`milestone:${milestoneNumber ?? "none"}`)
}

/** Canonical signature for an issue state + stateReason. */
export function signState(
  state: "open" | "closed",
  stateReason: "completed" | "not_planned" | "reopened" | null,
): string {
  return sha256(`state:${state}:${stateReason ?? "none"}`)
}

/** Canonical signature for an issue title. */
export function signTitle(title: string): string {
  return sha256(`title:${title}`)
}

/** Canonical signature for a comment upsert. Combines the GitHub comment id and SHA of the body. */
export function signCommentUpsert(githubCommentId: number, body: string): string {
  return sha256(`${githubCommentId}:${sha256(body)}`)
}

/** Canonical signature for a comment delete. Keyed only by the GitHub comment id. */
export function signCommentDelete(githubCommentId: number): string {
  return sha256(String(githubCommentId))
}

/** Diff two assignee login sets, returning logins to add and remove. */
export function diffAssignees(
  current: string[],
  desired: string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current)
  const desiredSet = new Set(desired)
  const toAdd = desired.filter((l) => !currentSet.has(l))
  const toRemove = current.filter((l) => !desiredSet.has(l))
  return { toAdd, toRemove }
}
