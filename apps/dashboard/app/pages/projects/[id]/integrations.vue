<script setup lang="ts">
import GithubPanel from "~/components/integrations/github/github-panel.vue"

const route = useRoute()
const projectId = computed(() => String(route.params.id))
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-semibold text-default">Integrations</h1>
      <p class="text-sm text-muted mt-1">
        Connect external services to mirror reports and enrich triage.
      </p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GithubPanel :project-id="projectId" />
      <!-- Future: SlackPanel, LinearPanel, etc. Each is its own card. -->
    </div>
  </div>
</template>
