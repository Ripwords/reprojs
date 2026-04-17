export default defineNuxtRouteMiddleware(async () => {
  // See auth.global.ts — authClient.getSession() drops cookies during SSR.
  let role: string | undefined
  try {
    const fetchWithCookies = useRequestFetch()
    const session = await fetchWithCookies<{ user?: { role?: string } }>("/api/auth/get-session")
    role = session?.user?.role
  } catch {
    // ignore — treated as non-admin below
  }

  if (role !== "admin") {
    return navigateTo("/")
  }
})
