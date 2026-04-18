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
