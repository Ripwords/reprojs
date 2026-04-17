<script setup lang="ts">
definePageMeta({ layout: "auth" })
const { signIn } = useSession()
const config = useRuntimeConfig()
const email = ref("")
const password = ref("")
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const { error: err } = await signIn.email({ email: email.value, password: password.value })
  if (err) {
    error.value = err.message ?? "Sign in failed"
    return
  }
  await navigateTo((useRoute().query.next as string) || "/")
}

async function oauth(provider: "github" | "google") {
  await signIn.social({ provider, callbackURL: "/" })
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Sign in</h1>
    <form class="space-y-3" @submit.prevent="submit">
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
      <button class="w-full bg-neutral-900 text-white rounded py-2">Sign in</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <div v-if="config.public.hasGithubOAuth || config.public.hasGoogleOAuth" class="space-y-2">
      <div class="text-xs text-neutral-500 text-center">or</div>
      <button
        v-if="config.public.hasGithubOAuth"
        class="w-full border rounded py-2"
        @click="oauth('github')"
      >
        Continue with GitHub
      </button>
      <button
        v-if="config.public.hasGoogleOAuth"
        class="w-full border rounded py-2"
        @click="oauth('google')"
      >
        Continue with Google
      </button>
    </div>
    <p class="text-sm text-neutral-500 text-center">
      No account? <NuxtLink to="/auth/sign-up" class="underline">Sign up</NuxtLink>
    </p>
  </div>
</template>
