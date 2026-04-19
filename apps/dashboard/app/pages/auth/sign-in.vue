<script setup lang="ts">
definePageMeta({ layout: "auth" })

const { session, signIn } = useSession()
const config = useRuntimeConfig()
const router = useRouter()
const route = useRoute()
const toast = useToast()

// If already signed in, bounce to the projects index.
watchEffect(() => {
  if (session.value?.data?.user) {
    router.replace("/")
  }
})

const email = ref("")
const magicLinkSent = ref(false)
const sendingLink = ref(false)

// Surface gate rejections from the server-side auth pipeline. The magic-link
// verify + OAuth callback redirect here with `?error=<reason>` when the
// workspace domain allowlist or invite gate blocks a sign-in.
const gateErrorMessages: Record<string, string> = {
  domain_not_allowed: "Your email domain isn't allowed on this workspace.",
  not_invited: "Sign-up is invite-only. Ask an admin to invite you first.",
}
const gateError = computed(() => {
  const code = route.query.error
  if (typeof code !== "string") return null
  return gateErrorMessages[code] ?? "Sign-in was rejected."
})

async function sendMagicLink() {
  if (!email.value) return
  sendingLink.value = true
  try {
    // callbackURL is where the browser lands AFTER the token is verified and
    // the session cookie is set. `next` preserves the pre-redirect target.
    const callbackURL = (route.query.next as string) || "/"
    const { error: err } = await signIn.magicLink({
      email: email.value,
      callbackURL,
    })
    if (err) {
      toast.add({
        title: "Could not send sign-in link",
        description: err.message ?? undefined,
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
      return
    }
    magicLinkSent.value = true
  } finally {
    sendingLink.value = false
  }
}

async function oauth(provider: "github" | "google") {
  try {
    await signIn.social({ provider, callbackURL: (route.query.next as string) || "/" })
  } catch (err) {
    toast.add({
      title: `${provider === "github" ? "GitHub" : "Google"} sign-in failed`,
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

const hasOAuth = computed(() => config.public.hasGithubOAuth || config.public.hasGoogleOAuth)
</script>

<template>
  <UCard :ui="{ body: 'p-8' }">
    <div class="space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-semibold text-default">Sign in</h1>
        <p class="text-sm text-muted mt-1.5">Welcome back to Feedback Tool.</p>
      </div>

      <div
        v-if="gateError"
        class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-sm text-error"
      >
        {{ gateError }}
      </div>

      <div
        v-if="magicLinkSent"
        class="rounded-lg border border-success/30 bg-success/5 px-3 py-3 text-sm text-default"
      >
        Check your inbox — we sent a sign-in link to <strong>{{ email }}</strong
        >. It expires in 5 minutes.
      </div>

      <form v-else class="space-y-3" @submit.prevent="sendMagicLink">
        <UFormField label="Email" required>
          <UInput
            v-model="email"
            type="email"
            placeholder="you@company.com"
            autocomplete="email"
            size="md"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          label="Email me a sign-in link"
          color="primary"
          :loading="sendingLink"
          block
        />
      </form>

      <template v-if="!magicLinkSent && hasOAuth">
        <UDivider label="or" />

        <div class="space-y-2">
          <UButton
            v-if="config.public.hasGithubOAuth"
            label="Continue with GitHub"
            icon="i-simple-icons-github"
            color="neutral"
            variant="outline"
            block
            @click="oauth('github')"
          />
          <UButton
            v-if="config.public.hasGoogleOAuth"
            label="Continue with Google"
            icon="i-simple-icons-google"
            color="neutral"
            variant="outline"
            block
            @click="oauth('google')"
          />
        </div>
      </template>
    </div>
  </UCard>
</template>
