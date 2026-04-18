<script setup lang="ts">
definePageMeta({ layout: "auth" })
const route = useRoute()

const rawToken = route.query.token
const token = typeof rawToken === "string" && rawToken.length > 0 ? rawToken : null

const { error } = await useAsyncData<unknown>(
  `verify-email-${token ?? "missing"}`,
  () =>
    $fetch<unknown>(`/api/auth/verify-email?token=${encodeURIComponent(token ?? "")}`, {
      credentials: "include",
    }),
  { immediate: token !== null },
)

const status = computed<"verifying" | "ok" | "error">(() => {
  if (token === null) return "error"
  if (error.value) return "error"
  return "ok"
})

if (import.meta.client && status.value === "ok") {
  setTimeout(() => navigateTo("/"), 1500)
}
</script>

<template>
  <div class="space-y-2 text-center">
    <h1 class="text-lg font-semibold">Email verification</h1>
    <p v-if="status === 'verifying'">Verifying…</p>
    <p v-else-if="status === 'ok'" class="text-green-700">Verified! Redirecting…</p>
    <p v-else class="text-red-600">Verification failed or link expired.</p>
  </div>
</template>
