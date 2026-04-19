<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"
import AppEmptyState from "~/components/common/app-empty-state.vue"

const toast = useToast()
const route = useRoute()
const router = useRouter()

// If the project-exists middleware bounced us here, surface a toast once.
onMounted(() => {
  if (route.query.error === "project-not-found") {
    toast.add({
      title: "Project not found",
      description: "The project you tried to open doesn't exist or you don't have access.",
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
    // Clean the URL so a refresh doesn't re-fire the toast.
    router.replace({ query: {} })
  }
})
const {
  data: projects,
  pending,
  refresh,
} = await useApi<ProjectDTO[]>("/api/projects", {
  default: () => [],
})

const list = computed(() => projects.value ?? [])

const newOpen = ref(false)
const newName = ref("")
const creating = ref(false)

// Any authenticated user can create a project — the server's POST /api/projects
// only calls requireSession (not requireInstallAdmin). The UI mirrors that.
const { session } = useSession()
const canCreate = computed(() => Boolean(session.value?.data?.user))

async function createProject() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    await $fetch<ProjectDTO>("/api/projects", {
      method: "POST",
      baseURL: useRuntimeConfig().public.betterAuthUrl,
      credentials: "include",
      body: { name: newName.value.trim() },
    })
    toast.add({
      title: "Project created",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
    newOpen.value = false
    newName.value = ""
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not create project",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-default">Projects</h1>
        <p class="text-sm text-muted mt-1">All the apps and sites sending you reports.</p>
      </div>
      <UButton
        v-if="canCreate"
        label="New project"
        icon="i-heroicons-plus"
        color="primary"
        @click="newOpen = true"
      />
    </header>

    <AppEmptyState
      v-if="!pending && list.length === 0"
      variant="gradient"
      icon="i-heroicons-squares-plus"
      title="Create your first project"
      description="A project groups incoming reports from a single app or site. You'll get an SDK key once it's created."
      action-label="New project"
      @action="newOpen = true"
    />

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <NuxtLink
        v-for="p in list"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="block rounded-xl border border-default bg-default p-5 transition hover:border-primary hover:shadow-sm"
      >
        <h3 class="text-base font-semibold text-default truncate">{{ p.name }}</h3>
        <p class="mt-1 text-sm text-muted">Role: {{ p.effectiveRole }}</p>
      </NuxtLink>
      <button
        v-if="canCreate"
        type="button"
        class="rounded-xl border-2 border-dashed border-default p-5 flex flex-col items-center justify-center text-muted hover:border-primary hover:text-primary transition-colors"
        @click="newOpen = true"
      >
        <UIcon name="i-heroicons-plus" class="size-8" />
        <span class="mt-2 text-sm font-medium">New project</span>
      </button>
    </div>

    <UModal v-model:open="newOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <form class="p-6 space-y-4" @submit.prevent="createProject">
          <h3 class="text-lg font-semibold text-default">Create project</h3>
          <UFormField label="Name" required>
            <UInput v-model="newName" placeholder="My App" autofocus class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="newOpen = false" />
            <UButton type="submit" label="Create" color="primary" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
