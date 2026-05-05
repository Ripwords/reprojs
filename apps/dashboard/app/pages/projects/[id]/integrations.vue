<script setup lang="ts">
import GithubPanel from "~/components/integrations/github/github-panel.vue"

const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.id))
const toast = useToast()

useHead({ title: "Integrations" })

onMounted(() => {
  const installed = route.query.installed === "1"
  const updated = route.query.updated === "1"
  if (!installed && !updated) return
  toast.add({
    title: installed ? "GitHub App installed" : "GitHub installation updated",
    description: "Pick a repository below to start syncing reports.",
    color: "success",
    icon: "i-heroicons-check-circle",
  })
  const { installed: _i, updated: _u, ...rest } = route.query
  router.replace({ query: rest })
})
</script>

<template>
  <div class="space-y-8">
    <header>
      <div class="text-sm font-medium uppercase tracking-[0.18em] text-muted">Project</div>
      <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight">Integrations</h1>
      <p class="mt-2 text-sm text-muted max-w-xl">
        Connect external services to mirror reports and enrich triage.
      </p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GithubPanel :project-id="projectId" />
      <!-- Future: SlackPanel, LinearPanel, etc. Each is its own card. -->
    </div>
  </div>
</template>
