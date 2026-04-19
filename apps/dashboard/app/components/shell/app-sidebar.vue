<script setup lang="ts">
import { computed, watch } from "vue"
import { useRoute } from "vue-router"
import type { ProjectDTO } from "@feedback-tool/shared"

const route = useRoute()
const { isAdmin } = useSession()
const collapsed = useCookie<boolean>("sidebar-collapsed", {
  default: () => false,
})

// Remember the most-recently-visited project across route changes so the
// project nav stays visible even on admin-scope pages (/settings/users,
// /settings/install) and on the projects index. Without this, navigating
// from a project into admin makes the project nav disappear, which feels
// like the sidebar is "losing" context.
const lastProjectId = useCookie<string | null>("last-project-id", {
  default: () => null,
})

// Piggybacks on the same `/api/projects` request as the project-switcher —
// Nuxt's useFetch dedupes by URL, so this doesn't add a round-trip. We need
// the list to (a) validate `lastProjectId` against reality and (b) know
// whether the user has any projects at all (empty-state vs dead-link case).
const { data: projectsData } = await useApi<ProjectDTO[]>("/api/projects", {
  default: () => [],
})
const projectIds = computed(() => new Set((projectsData.value ?? []).map((p) => p.id)))
const hasAnyProject = computed(() => (projectsData.value?.length ?? 0) > 0)

const routeProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

// Update the cookie whenever we enter a valid project route.
watch(
  routeProjectId,
  (id) => {
    if (id) lastProjectId.value = id
  },
  { immediate: true },
)

// Clear the cookie when it points at a project the user can no longer see
// (deleted, access revoked, or a stale UUID from an old session). Without
// this, project-scoped nav items render links that bounce straight back to
// `/?error=project-not-found` — the sidebar looks alive but is dead.
watch(
  [lastProjectId, projectIds],
  ([id, ids]) => {
    if (id && ids.size > 0 && !ids.has(id)) {
      lastProjectId.value = null
    }
  },
  { immediate: true },
)

// Effective project scope: current route > last-visited cookie (if valid).
const projectId = computed(() => {
  const routeId = routeProjectId.value
  if (routeId) return routeId
  const cookieId = lastProjectId.value
  if (cookieId && projectIds.value.has(cookieId)) return cookieId
  return null
})

interface NavItem {
  label: string
  icon: string
  to: string
  badge?: string | number
}

const projectItems = computed<NavItem[]>(() => {
  if (!projectId.value) return []
  const base = `/projects/${projectId.value}`
  return [
    { label: "Overview", icon: "i-heroicons-home", to: base },
    {
      label: "Reports",
      icon: "i-heroicons-inbox-stack",
      to: `${base}/reports`,
    },
    { label: "Members", icon: "i-heroicons-user-group", to: `${base}/members` },
    {
      label: "Integrations",
      icon: "i-heroicons-squares-plus",
      to: `${base}/integrations`,
    },
    {
      label: "Settings",
      icon: "i-heroicons-cog-6-tooth",
      to: `${base}/settings`,
    },
  ]
})

const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    {
      label: "Install",
      icon: "i-heroicons-code-bracket",
      to: "/settings/install",
    },
  ]
})

const width = computed(() => (collapsed.value ? "w-14" : "w-60"))

function toggle() {
  collapsed.value = !collapsed.value
}

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + "/")
}
</script>

<template>
  <aside
    :class="[
      width,
      'flex-shrink-0 border-r border-default bg-default flex flex-col transition-[width] duration-150',
    ]"
  >
    <div class="h-12 flex items-center px-3 border-b border-default">
      <UButton
        :icon="collapsed ? 'i-heroicons-bars-3' : 'i-heroicons-chevron-left'"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      />
    </div>
    <nav class="flex-1 overflow-y-auto py-2">
      <div v-if="projectItems.length > 0" class="space-y-0.5 px-2">
        <UButton
          v-for="item in projectItems"
          :key="item.to"
          :to="item.to"
          :icon="item.icon"
          :label="collapsed ? undefined : item.label"
          :active="isActive(item.to)"
          color="neutral"
          variant="ghost"
          size="sm"
          block
          :class="collapsed ? 'justify-center px-0' : 'justify-start'"
        >
          <template v-if="!collapsed && item.badge" #trailing>
            <UBadge :label="String(item.badge)" size="xs" variant="soft" />
          </template>
        </UButton>
      </div>
      <div v-else-if="!collapsed" class="px-3">
        <UButton
          to="/"
          :icon="hasAnyProject ? 'i-heroicons-squares-2x2' : 'i-heroicons-plus'"
          :label="hasAnyProject ? 'Choose a project' : 'Create your first project'"
          :active="route.path === '/'"
          color="neutral"
          variant="ghost"
          size="sm"
          block
          class="justify-start"
        />
      </div>
      <div v-else class="px-2">
        <UButton
          to="/"
          :icon="hasAnyProject ? 'i-heroicons-squares-2x2' : 'i-heroicons-plus'"
          :active="route.path === '/'"
          :aria-label="hasAnyProject ? 'Choose a project' : 'Create a project'"
          color="neutral"
          variant="ghost"
          size="sm"
          block
          class="justify-center px-0"
        />
      </div>
      <div v-if="adminItems.length > 0">
        <div v-if="!collapsed" class="mt-4 mb-1 px-3 text-xs font-medium uppercase text-muted">
          Admin
        </div>
        <USeparator v-else class="my-3" />
        <div class="space-y-0.5 px-2">
          <UButton
            v-for="item in adminItems"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :label="collapsed ? undefined : item.label"
            :active="isActive(item.to)"
            color="neutral"
            variant="ghost"
            size="sm"
            block
            :class="collapsed ? 'justify-center px-0' : 'justify-start'"
          />
        </div>
      </div>
    </nav>
  </aside>
</template>
