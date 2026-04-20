<script setup lang="ts">
definePageMeta({ middleware: "admin-only" })
useHead({ title: "GitHub App" })

const route = useRoute()
// Resolved at request time so the webhook URL shown in the instructions —
// and the manifest-start redirect — always match the hostname operators are
// viewing, even on pre-built Docker images where BETTER_AUTH_URL wasn't set
// at build time.
const dashboardUrl = useRequestURL().origin

interface AppStatus {
  configured: boolean
  source?: "env" | "db"
  slug?: string
  appId?: string
}

const { data: status, refresh } = await useApi<AppStatus>("/api/integrations/github/app-status")

const justCreated = computed(() => route.query.created === "1")

const orgInput = ref("")
const creating = ref(false)

function startManifestFlow() {
  creating.value = true
  const org = orgInput.value.trim()
  const url = org
    ? `${dashboardUrl}/api/integrations/github/manifest-start?org=${encodeURIComponent(org)}`
    : `${dashboardUrl}/api/integrations/github/manifest-start`
  window.location.href = url
}

const githubAppSettingsUrl = computed(() => {
  if (!status.value?.slug) return null
  return `https://github.com/settings/apps/${status.value.slug}`
})

const githubAppPublicUrl = computed(() => {
  if (!status.value?.slug) return null
  return `https://github.com/apps/${status.value.slug}`
})
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <header>
      <h1 class="text-2xl font-semibold text-default">GitHub integration</h1>
      <p class="text-sm text-muted mt-1">
        Connect this instance to GitHub so ticket triage can mirror to issues. A GitHub App is
        installed on your organization or personal account — each self-hosted Repro instance creates
        its own app with its own credentials.
      </p>
    </header>

    <UAlert
      v-if="justCreated"
      color="success"
      icon="i-heroicons-check-circle"
      title="GitHub App created"
      description="Credentials have been stored securely. One manual step remains — enable webhook delivery in your GitHub App settings (see the card below)."
    />

    <UCard v-if="!status?.configured">
      <template #header>
        <h2 class="text-base font-semibold text-default">Create GitHub App</h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          GitHub will create a new app on your account with the callback and setup URLs
          pre-configured for this instance. The app's private key, webhook secret, and client
          credentials are returned to this dashboard and stored encrypted at rest.
        </p>
        <div>
          <label for="org" class="block text-sm font-medium text-default mb-1">
            Organization (optional)
          </label>
          <UInput id="org" v-model="orgInput" placeholder="my-org" class="max-w-sm" />
          <p class="text-xs text-muted mt-1">
            Leave empty to create the app on your personal GitHub account.
          </p>
        </div>
        <p class="text-xs text-muted">
          <strong class="text-default">Note:</strong> The app is created with webhooks
          <strong>disabled</strong>. You'll need to enable them manually after setup to receive
          two-way sync events. See the instructions shown after the app is created.
        </p>
        <UButton :loading="creating" color="primary" icon="i-mdi-github" @click="startManifestFlow">
          Create GitHub App
        </UButton>
      </div>
    </UCard>

    <UCard v-else>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-default">GitHub App configured</h2>
          <UBadge :color="status.source === 'env' ? 'neutral' : 'success'" variant="subtle">
            {{ status.source === "env" ? "Env vars" : "In-app setup" }}
          </UBadge>
        </div>
      </template>
      <dl class="space-y-3 text-sm">
        <div class="flex gap-4">
          <dt class="text-muted w-28">App ID</dt>
          <dd class="font-mono text-default">{{ status.appId }}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="text-muted w-28">Slug</dt>
          <dd class="font-mono text-default">{{ status.slug }}</dd>
        </div>
        <div v-if="githubAppPublicUrl" class="flex gap-4">
          <dt class="text-muted w-28">Public page</dt>
          <dd>
            <ULink :to="githubAppPublicUrl" target="_blank" class="text-primary">
              {{ githubAppPublicUrl }}
            </ULink>
          </dd>
        </div>
      </dl>
      <template v-if="status.source === 'env'" #footer>
        <p class="text-xs text-muted">
          This instance reads GitHub App credentials from environment variables. To migrate to the
          in-app setup flow, unset the <code>GITHUB_APP_*</code> vars and reload this page.
        </p>
      </template>
      <template v-else #footer>
        <div class="flex gap-2">
          <UButton variant="subtle" color="neutral" @click="() => refresh()">Refresh</UButton>
        </div>
      </template>
    </UCard>

    <UCard v-if="status?.configured && status.source === 'db'">
      <template #header>
        <h2 class="text-base font-semibold text-default">Enable webhooks (manual step)</h2>
      </template>
      <div class="space-y-3 text-sm">
        <p class="text-muted">
          Webhooks power two-way sync (GitHub issue closed → Repro ticket closed). GitHub requires
          the webhook URL to be publicly reachable before an app is created, so Repro creates the
          app with webhooks <strong>disabled</strong>. Enable them yourself in one step:
        </p>
        <ol class="list-decimal pl-5 space-y-1 text-muted">
          <li>
            Open
            <ULink :to="githubAppSettingsUrl ?? '#'" target="_blank" class="text-primary">
              your GitHub App settings page
            </ULink>
            (Owner &rarr; Edit).
          </li>
          <li>Scroll to <strong>Webhook</strong>.</li>
          <li>
            Set the URL to
            <code class="font-mono px-1 rounded bg-muted">
              {{ dashboardUrl }}/api/integrations/github/webhook
            </code>
          </li>
          <li>Check <strong>Active</strong> and click <strong>Save changes</strong>.</li>
        </ol>
        <p class="text-xs text-muted">
          The webhook secret was already generated and stored during setup — no need to change it.
        </p>
      </div>
    </UCard>
  </div>
</template>
