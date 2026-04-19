<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute, useRouter } from "vue-router"

interface ProjectSummary {
  id: string
  name: string
}

const route = useRoute()
const router = useRouter()
const open = ref(false)

const { data } = await useApi<ProjectSummary[]>("/api/projects", { default: () => [] })

const currentProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

const currentProject = computed(
  () => data.value?.find((p) => p.id === currentProjectId.value) ?? null,
)

const items = computed(() =>
  (data.value ?? []).map((p) => ({
    label: p.name,
    onSelect: () => {
      router.push(`/projects/${p.id}`)
      open.value = false
    },
  })),
)
</script>

<template>
  <div>
    <UButton
      :label="currentProject?.name ?? 'Feedback Tool'"
      trailing-icon="i-heroicons-chevron-down"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="open = true"
    />
    <UModal v-model:open="open" :ui="{ content: 'max-w-lg' }">
      <template #content>
        <UCommandPalette :groups="[{ id: 'projects', label: 'Projects', items }]" />
      </template>
    </UModal>
  </div>
</template>
