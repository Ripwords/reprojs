import { createAuthClient } from "better-auth/vue"

// Lazy singleton — must be created inside Nuxt context (composable, middleware, plugin, setup)
let _client: ReturnType<typeof createAuthClient> | null = null

export function useAuthClient() {
  if (!_client) {
    _client = createAuthClient({
      baseURL: useRuntimeConfig().public.betterAuthUrl,
    })
  }
  return _client
}
