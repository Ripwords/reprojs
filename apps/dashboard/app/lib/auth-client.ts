import { createAuthClient } from "better-auth/vue"
import { magicLinkClient } from "better-auth/client/plugins"

// The lazy-singleton pattern would erase the plugin generics (because
// `ReturnType<typeof createAuthClient>` loses the `Option` type parameter),
// so we materialize the typed client once via a factory and let TypeScript
// infer the full shape — including signIn.magicLink — through `AuthClient`.
function makeClient() {
  return createAuthClient({
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    plugins: [magicLinkClient()],
  })
}

type AuthClient = ReturnType<typeof makeClient>

let _client: AuthClient | null = null

export function useAuthClient(): AuthClient {
  if (!_client) {
    _client = makeClient()
  }
  return _client
}
