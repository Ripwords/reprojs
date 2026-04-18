<script setup lang="ts">
import type { AppSettingsDTO } from "@feedback-tool/shared"

definePageMeta({ middleware: "admin-only" })

const { data: settings, refresh } = await useApi<AppSettingsDTO>("/api/settings")
const gated = ref(settings.value?.signupGated ?? false)
const domainsText = ref((settings.value?.allowedEmailDomains ?? []).join("\n"))
const error = ref<string | null>(null)
const saving = ref(false)

async function save() {
  saving.value = true
  error.value = null
  const allowedEmailDomains = domainsText.value
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  try {
    await $fetch("/api/settings", {
      method: "PATCH",
      baseURL: useRuntimeConfig().public.betterAuthUrl,
      credentials: "include",
      body: { signupGated: gated.value, allowedEmailDomains },
    })
    await refresh()
    domainsText.value = (settings.value?.allowedEmailDomains ?? []).join("\n")
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = err?.data?.statusMessage ?? err?.statusMessage ?? "Save failed"
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-xl">
    <h1 class="text-2xl font-semibold">Install settings</h1>

    <form class="space-y-4" @submit.prevent="save">
      <section class="space-y-2">
        <label class="block">
          <span class="text-sm font-medium">Allowed email domains</span>
          <textarea
            v-model="domainsText"
            rows="4"
            placeholder="acme.com&#10;acme.co.uk"
            class="w-full border rounded px-3 py-2 font-mono text-xs mt-1"
          />
          <span class="text-xs text-neutral-500">
            One per line (or comma-separated). Leave empty to allow any email. When set, sign-ups
            are rejected unless the email domain matches one entry.
          </span>
        </label>
      </section>

      <section class="space-y-2">
        <label class="flex items-start gap-2">
          <input v-model="gated" type="checkbox" class="mt-1" />
          <span>
            <span class="text-sm font-medium">Require invite to sign up</span>
            <span class="block text-xs text-neutral-500">
              When enabled, only pre-invited email addresses can complete sign-up. Combines with the
              domain allowlist above — both gates must pass.
            </span>
          </span>
        </label>
      </section>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="saving"
          class="bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      </div>
    </form>
  </div>
</template>
