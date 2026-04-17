<script setup lang="ts">
definePageMeta({ layout: "auth" })
const route = useRoute()
const password = ref("")
const done = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  try {
    await $fetch("/api/invites/accept", {
      method: "POST",
      body: { token: route.query.token, password: password.value },
    })
    done.value = true
    setTimeout(() => navigateTo("/auth/sign-in"), 1500)
  } catch (e: unknown) {
    const err = e as { statusMessage?: string }
    error.value = err?.statusMessage ?? "Invite expired or invalid"
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Accept invitation</h1>
    <div v-if="done" class="text-green-700 text-sm">Done! Redirecting to sign in…</div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <input
        v-model="password"
        type="password"
        placeholder="Set a password"
        class="w-full border rounded px-3 py-2"
        required
      />
      <button class="w-full bg-neutral-900 text-white rounded py-2">Accept invite</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </div>
</template>
