import { useAuthClient } from "../lib/auth-client"

export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuthClient().getSession()
  if ((data?.user as { role?: string } | undefined)?.role !== "admin") {
    return navigateTo("/")
  }
})
