import { createAuthClient } from "better-auth/vue"
import { magicLinkClient } from "better-auth/client/plugins"

// The lazy-singleton pattern would erase the plugin generics (because
// `ReturnType<typeof createAuthClient>` loses the `Option` type parameter),
// so we materialize the typed client once via a factory and let TypeScript
// infer the full shape — including signIn.magicLink — through `AuthClient`.
function makeClient() {
  return createAuthClient({
    baseURL: useRequestURL().origin,
    plugins: [magicLinkClient()],
  })
}

type AuthClient = ReturnType<typeof makeClient>

// Client-side singleton: `window.location.origin` is stable for the life of
// the page, so caching is safe and cheap. On SSR we intentionally skip the
// cache — a module-level singleton would capture the FIRST request's origin
// and then serve a wrong baseURL for subsequent requests hitting the same
// process from a different hostname (self-hosters occasionally front the
// dashboard with multiple domains).
let _clientCache: AuthClient | null = null

export function useAuthClient(): AuthClient {
  if (import.meta.client && _clientCache) return _clientCache
  const client = makeClient()
  if (import.meta.client) _clientCache = client
  return client
}
