<script setup lang="ts">
import GithubPanel from "~/components/integrations/github/github-panel.vue"

const route = useRoute()
const projectId = computed(() => String(route.params.id))
</script>

<template>
  <div class="space-y-8">
    <header>
      <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted">Project</div>
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
