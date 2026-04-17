<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"

const { data, refresh } = await useApi<ProjectDTO[]>("/api/projects")
const newName = ref("")

async function create() {
  if (!newName.value.trim()) return
  await $fetch("/api/projects", {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { name: newName.value },
  })
  newName.value = ""
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Projects</h1>
      <form class="flex gap-2" @submit.prevent="create">
        <input v-model="newName" placeholder="New project name" class="border rounded px-3 py-2" />
        <button class="bg-neutral-900 text-white rounded px-4 py-2">Create</button>
      </form>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <NuxtLink
        v-for="p in data"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="block border rounded-lg p-4 bg-white hover:bg-neutral-50"
      >
        <div class="font-semibold">{{ p.name }}</div>
        <div class="text-xs text-neutral-500">/{{ p.slug }} · {{ p.effectiveRole }}</div>
      </NuxtLink>
      <div v-if="data?.length === 0" class="text-neutral-500 col-span-full">No projects yet.</div>
    </div>
  </div>
</template>
