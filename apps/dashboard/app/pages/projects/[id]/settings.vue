<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"

const route = useRoute()
const { data: project, refresh } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const name = ref(project.value?.name ?? "")
const slug = ref(project.value?.slug ?? "")

async function save() {
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { name: name.value, slug: slug.value },
  })
  await refresh()
}

async function softDelete() {
  if (!confirm("Delete this project?")) return
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await navigateTo("/")
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <h1 class="text-2xl font-semibold">Project settings</h1>
    <form class="space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="text-sm">Name</span>
        <input v-model="name" class="w-full border rounded px-3 py-2" />
      </label>
      <label class="block">
        <span class="text-sm">Slug</span>
        <input v-model="slug" class="w-full border rounded px-3 py-2" />
      </label>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Save</button>
    </form>
    <div class="border-t pt-4">
      <button class="text-red-600" @click="softDelete">Delete project</button>
    </div>
  </div>
</template>
