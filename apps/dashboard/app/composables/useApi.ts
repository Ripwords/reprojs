export const useApi = <T>(path: string, opts: Parameters<typeof useFetch<T>>[1] = {}) =>
  useFetch<T>(path, {
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    ...opts,
  })
