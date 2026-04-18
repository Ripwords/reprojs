<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"
import GithubPanel from "~/components/integrations/github/github-panel.vue"

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const runtime = useRuntimeConfig()
const dashboardUrl = runtime.public.betterAuthUrl
const { data: project, refresh } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const name = ref(project.value?.name ?? "")
const originsText = ref((project.value?.allowedOrigins ?? []).join("\n"))
const dailyReportCap = ref(project.value?.dailyReportCap ?? 1000)
const rotating = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

async function save() {
  saving.value = true
  error.value = null
  const allowedOrigins = originsText.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    await $fetch(`/api/projects/${route.params.id}`, {
      method: "PATCH",
      baseURL: dashboardUrl,
      credentials: "include",
      body: { name: name.value, allowedOrigins, dailyReportCap: dailyReportCap.value },
    })
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = err?.data?.statusMessage ?? err?.statusMessage ?? "Save failed"
  } finally {
    saving.value = false
  }
}

async function rotateKey() {
  if (
    !confirm(
      "Rotating invalidates the current key immediately. Embeds using the old key will stop working. Continue?",
    )
  )
    return
  rotating.value = true
  try {
    await $fetch(`/api/projects/${route.params.id}/rotate-key`, {
      method: "POST",
      baseURL: dashboardUrl,
      credentials: "include",
    })
    await refresh()
  } finally {
    rotating.value = false
  }
}

async function softDelete() {
  if (!confirm("Delete this project?")) return
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "DELETE",
    baseURL: dashboardUrl,
    credentials: "include",
  })
  await navigateTo("/")
}
</script>

<template>
  <div class="space-y-8 max-w-lg">
    <h1 class="text-2xl font-semibold">Project settings</h1>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-600">General</h2>
      <form class="space-y-3" @submit.prevent="save">
        <label class="block">
          <span class="text-sm">Name</span>
          <input v-model="name" class="w-full border rounded px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm">
            Allowed origins
            <span class="text-neutral-500"
              >(one per line, e.g. <code>http://localhost:4000</code>)</span
            >
          </span>
          <textarea
            v-model="originsText"
            rows="4"
            class="w-full border rounded px-3 py-2 font-mono text-xs"
          />
        </label>
        <label class="block">
          <span class="text-sm">
            Daily report limit
            <span class="text-neutral-500">
              (hard cap on reports created per 24h; protects against runaway spam)
            </span>
          </span>
          <input
            v-model.number="dailyReportCap"
            type="number"
            min="1"
            max="1000000"
            class="w-full border rounded px-3 py-2"
          />
        </label>
        <button
          type="submit"
          :disabled="saving"
          class="bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {{ saving ? "Saving\u2026" : "Save" }}
        </button>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      </form>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-600">Embed key</h2>
      <div class="border rounded-lg bg-white p-4 space-y-2">
        <div class="font-mono text-sm break-all">
          {{ project?.publicKey ?? "(not generated)" }}
        </div>
        <button
          type="button"
          class="text-sm underline text-red-600 disabled:opacity-50"
          :disabled="rotating"
          @click="rotateKey"
        >
          {{ rotating ? "Rotating\u2026" : "Rotate key" }}
        </button>
      </div>
      <pre
        class="text-xs bg-neutral-100 rounded p-3 overflow-x-auto"
      ><code>&lt;script src=&quot;{{ dashboardUrl }}/sdk/feedback-tool.iife.js&quot;&gt;&lt;/script&gt;
&lt;script&gt;
  FeedbackTool.init({
    projectKey: &quot;{{ project?.publicKey ?? 'ft_pk_...' }}&quot;,
    endpoint: &quot;{{ dashboardUrl }}&quot;
  })
&lt;/script&gt;</code></pre>
    </section>

    <section class="border-t pt-6">
      <GithubPanel :project-id="projectId" />
    </section>

    <section class="border-t pt-4">
      <button type="button" class="text-red-600" @click="softDelete">Delete project</button>
    </section>
  </div>
</template>
