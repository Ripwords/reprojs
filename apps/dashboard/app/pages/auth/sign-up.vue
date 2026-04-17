<script setup lang="ts">
definePageMeta({ layout: "auth" })
const { signUp } = useSession()
const email = ref("")
const password = ref("")
const name = ref("")
const sent = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const { error: err } = await signUp.email({
    email: email.value,
    password: password.value,
    name: name.value,
  })
  if (err) {
    error.value = err.message ?? "Sign up failed"
    return
  }
  sent.value = true
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Sign up</h1>
    <div v-if="sent" class="text-sm">Check your email for a verification link.</div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <input v-model="name" placeholder="Name" class="w-full border rounded px-3 py-2" />
      <input
        v-model="email"
        type="email"
        placeholder="Email"
        class="w-full border rounded px-3 py-2"
        required
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        class="w-full border rounded px-3 py-2"
        required
      />
      <button class="w-full bg-neutral-900 text-white rounded py-2">Sign up</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <p class="text-sm text-neutral-500 text-center">
      Have an account? <NuxtLink to="/auth/sign-in" class="underline">Sign in</NuxtLink>
    </p>
  </div>
</template>
