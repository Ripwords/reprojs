<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"

const route = useRoute()
const { data: project } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">{{ project?.name }}</h1>
        <div class="text-xs text-neutral-500">
          /{{ project?.slug }} · role: {{ project?.effectiveRole }}
        </div>
      </div>
      <div class="flex gap-3 text-sm">
        <NuxtLink :to="`/projects/${project?.id}/members`" class="underline">Members</NuxtLink>
        <NuxtLink
          v-if="project?.effectiveRole === 'owner'"
          :to="`/projects/${project?.id}/settings`"
          class="underline"
          >Settings</NuxtLink
        >
      </div>
    </div>
    <div class="border rounded-lg p-6 bg-white text-neutral-500 text-sm">
      Tickets will appear here once the SDK intake lands (sub-project B).
    </div>
  </div>
</template>
