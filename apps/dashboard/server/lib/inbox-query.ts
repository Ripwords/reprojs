export interface TagDiff {
  added: string[]
  removed: string[]
}

export function diffTags(oldTags: readonly string[], newTags: readonly string[]): TagDiff {
  const oldSet = new Set(oldTags)
  const newSet = new Set(newTags)
  const added: string[] = []
  const removed: string[] = []
  for (const t of newSet) if (!oldSet.has(t)) added.push(t)
  for (const t of oldSet) if (!newSet.has(t)) removed.push(t)
  return { added, removed }
}

export type AssigneeFilter = { type: "user"; userId: string } | { type: "null" }

export function resolveAssigneeFilter(
  tokens: readonly string[],
  sessionUserId: string,
): AssigneeFilter[] {
  const seen = new Set<string>()
  const out: AssigneeFilter[] = []
  for (const t of tokens) {
    const resolved: AssigneeFilter =
      t === "me"
        ? { type: "user", userId: sessionUserId }
        : t === "unassigned"
          ? { type: "null" }
          : { type: "user", userId: t }
    const key = resolved.type === "null" ? "null" : `u:${resolved.userId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(resolved)
  }
  return out
}
