<script setup lang="ts">
definePageMeta({ layout: "auth" })
const { signIn } = useSession()
const config = useRuntimeConfig()
const route = useRoute()
const email = ref("")
const sent = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  submitting.value = true
  try {
    // callbackURL is where the browser lands AFTER the token is verified and
    // the session cookie is set. `next` preserves the pre-redirect target.
    const callbackURL = (route.query.next as string) || "/"
    const { error: err } = await signIn.magicLink({
      email: email.value,
      callbackURL,
    })
    if (err) {
      error.value = err.message ?? "Sign in failed"
      return
    }
    sent.value = true
  } finally {
    submitting.value = false
  }
}

async function oauth(provider: "github" | "google") {
  await signIn.social({ provider, callbackURL: (route.query.next as string) || "/" })
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Sign in</h1>
    <div v-if="sent" class="space-y-2 text-sm">
      <p class="text-green-700">Check your email.</p>
      <p class="text-neutral-600">
        We sent a sign-in link to <strong>{{ email }}</strong
        >. It expires in 5 minutes.
      </p>
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <input
        v-model="email"
        type="email"
        placeholder="Email"
        autocomplete="email"
        class="w-full border rounded px-3 py-2"
        required
      />
      <button
        :disabled="submitting"
        class="w-full bg-neutral-900 text-white rounded py-2 disabled:opacity-60"
      >
        {{ submitting ? "Sending…" : "Email me a sign-in link" }}
      </button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <div
      v-if="!sent && (config.public.hasGithubOAuth || config.public.hasGoogleOAuth)"
      class="space-y-2"
    >
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
  </div>
</template>
