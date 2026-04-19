/**
 * Guards /projects/[id]/* routes: pre-fetches the project and redirects to
 * `/` with a `?error=project-not-found` query param if the server returns
 * 404 or the caller lacks access (403). Runs before every navigation inside
 * a project so invalid UUIDs in the URL don't silently render empty pages.
 *
 * Applied per-page via `definePageMeta({ middleware: ["project-exists"] })`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const match = /^\/projects\/([^/]+)(?:\/.*)?$/.exec(to.path)
  if (!match) return

  const projectId = match[1]
  if (!projectId) return

  const config = useRuntimeConfig()
  try {
    await $fetch(`/api/projects/${projectId}`, {
      baseURL: config.public.betterAuthUrl,
      credentials: "include",
      headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    })
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? (err as { statusCode: unknown }).statusCode
        : null
    if (status === 404 || status === 403) {
      return navigateTo("/?error=project-not-found")
    }
    // Other errors (network / 500) — let the page handle its own fetch
    // failure rather than redirecting, so the user isn't bounced on a
    // transient outage.
  }
})
