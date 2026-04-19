<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()
const { isAdmin } = useSession()
const collapsed = useCookie<boolean>("sidebar-collapsed", { default: () => false })

const projectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
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
    { label: "Reports", icon: "i-heroicons-inbox-stack", to: `${base}/reports` },
    { label: "Members", icon: "i-heroicons-user-group", to: `${base}/members` },
    { label: "Integrations", icon: "i-heroicons-squares-plus", to: `${base}/integrations` },
    { label: "Settings", icon: "i-heroicons-cog-6-tooth", to: `${base}/settings` },
  ]
})

const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    { label: "Install", icon: "i-heroicons-code-bracket", to: "/settings/install" },
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
