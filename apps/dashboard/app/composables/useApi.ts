/**
 * Wrapper around `useFetch` that sends the browser's session cookie to the
 * dashboard API so protected endpoints see the caller's identity during SSR
 * and client navigation alike.
 *
 * SAME-ORIGIN ASSUMPTION:
 * `credentials: "include"` combined with a `baseURL` pointing at
 * `public.betterAuthUrl` assumes the dashboard UI and the API are served from
 * the SAME origin (the default self-host topology). If an operator splits
 * origins (e.g. `dashboard.example.com` for the UI and `auth.example.com` for
 * the API), the browser requires the API origin to respond with:
 *   - Access-Control-Allow-Credentials: true
 *   - Access-Control-Allow-Origin: <the exact dashboard origin> (never `*`)
 * The dashboard does NOT emit those headers today — the intake API emits CORS
 * headers WITHOUT credentials, which is deliberate for public SDK traffic.
 * Operators running a split-origin deployment must add a Nitro middleware
 * that emits the credentialed CORS headers for the dashboard origin.
 */
export const useApi = <T>(
  path: Parameters<typeof useFetch<T>>[0],
  opts: Parameters<typeof useFetch<T>>[1] = {},
) => {
  // Forward the incoming request's cookie during SSR so the API sees the
  // caller's session. Without this, protected endpoints return 401 on SSR
  // and the page hydrates in a broken state.
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined
  return useFetch<T>(path, {
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    headers,
    ...opts,
  })
}
