import { useAuthClient } from "../lib/auth-client"

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = [
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/verify-email",
    "/auth/accept-invite",
  ]
  if (publicPaths.some((p) => to.path.startsWith(p))) return

  const { data } = await useAuthClient().getSession()
  if (!data?.user) {
    return navigateTo(`/auth/sign-in?next=${encodeURIComponent(to.fullPath)}`)
  }
})
