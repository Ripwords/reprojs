// apps/dashboard/app/composables/use-inbox-query.ts
import type { LocationQueryRaw } from "vue-router"

export interface InboxQuery {
  status: string[]
  priority: string[]
  tag: string[]
  assignee: string[]
  q: string
  sort: "newest" | "oldest" | "priority" | "updated"
  limit: number
  offset: number
}

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function useInboxQuery() {
  const route = useRoute()
  const router = useRouter()

  const query = computed<InboxQuery>(() => {
    const q = route.query
    const sort = (typeof q.sort === "string" ? q.sort : "newest") as InboxQuery["sort"]
    return {
      status: parseCsv(q.status),
      priority: parseCsv(q.priority),
      tag: parseCsv(q.tag),
      assignee: parseCsv(q.assignee),
      q: typeof q.q === "string" ? q.q : "",
      sort: (["newest", "oldest", "priority", "updated"] as const).includes(sort) ? sort : "newest",
      limit: Number(q.limit ?? 50),
      offset: Number(q.offset ?? 0),
    }
  })

  function update(patch: Partial<InboxQuery>): void {
    const merged = { ...query.value, ...patch }
    const next: LocationQueryRaw = {}
    if (merged.status.length) next.status = merged.status.join(",")
    if (merged.priority.length) next.priority = merged.priority.join(",")
    if (merged.tag.length) next.tag = merged.tag.join(",")
    if (merged.assignee.length) next.assignee = merged.assignee.join(",")
    if (merged.q) next.q = merged.q
    if (merged.sort !== "newest") next.sort = merged.sort
    if (merged.offset > 0) next.offset = String(merged.offset)
    router.replace({ query: next })
  }

  function toApi(): string {
    const parts: string[] = []
    if (query.value.status.length) parts.push(`status=${query.value.status.join(",")}`)
    if (query.value.priority.length) parts.push(`priority=${query.value.priority.join(",")}`)
    if (query.value.tag.length) parts.push(`tag=${query.value.tag.join(",")}`)
    if (query.value.assignee.length) parts.push(`assignee=${query.value.assignee.join(",")}`)
    if (query.value.q) parts.push(`q=${encodeURIComponent(query.value.q)}`)
    parts.push(`sort=${query.value.sort}`)
    parts.push(`limit=${query.value.limit}`)
    parts.push(`offset=${query.value.offset}`)
    return parts.join("&")
  }

  return { query, update, toApi }
}
