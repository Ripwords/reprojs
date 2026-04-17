<script setup lang="ts">
definePageMeta({ layout: "auth" })
const route = useRoute()
const status = ref<"verifying" | "ok" | "error">("verifying")

onMounted(async () => {
  const token = route.query.token as string
  if (!token) {
    status.value = "error"
    return
  }
  try {
    await $fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
    status.value = "ok"
    setTimeout(() => navigateTo("/"), 1500)
  } catch {
    status.value = "error"
  }
})
</script>

<template>
  <div class="space-y-2 text-center">
    <h1 class="text-lg font-semibold">Email verification</h1>
    <p v-if="status === 'verifying'">Verifying…</p>
    <p v-else-if="status === 'ok'" class="text-green-700">Verified! Redirecting…</p>
    <p v-else class="text-red-600">Verification failed or link expired.</p>
  </div>
</template>
