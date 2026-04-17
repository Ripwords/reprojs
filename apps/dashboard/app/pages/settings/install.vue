<script setup lang="ts">
import type { AppSettingsDTO } from "@feedback-tool/shared"

definePageMeta({ middleware: "admin-only" })

const { data: settings, refresh } = await useApi<AppSettingsDTO>("/api/settings")
const name = ref(settings.value?.installName ?? "")
const gated = ref(settings.value?.signupGated ?? false)

async function save() {
  await $fetch("/api/settings", {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { installName: name.value, signupGated: gated.value },
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <h1 class="text-2xl font-semibold">Install settings</h1>
    <form class="space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="text-sm">Install name</span>
        <input v-model="name" class="w-full border rounded px-3 py-2" />
      </label>
      <label class="flex items-center gap-2">
        <input v-model="gated" type="checkbox" />
        <span class="text-sm">Require invite to sign up</span>
      </label>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Save</button>
    </form>
  </div>
</template>
