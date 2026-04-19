import type { InstallRole } from "@reprokit/shared"
import { useAuthClient } from "../lib/auth-client"

/**
 * better-auth's user row doesn't surface our custom `role` column in its own
 * types (the schema extension is wired server-side). Type the projection once
 * here so every consumer reaches for `role` / `isAdmin` off the composable
 * instead of re-doing `user as { role?: string }` casts at call sites.
 */
interface SessionUserWithRole {
  id?: string
  email?: string
  name?: string | null
  role?: InstallRole
}

export const useSession = () => {
  const client = useAuthClient()
  const session = client.useSession()

  const user = computed<SessionUserWithRole | null>(() => {
    const raw = session.value.data?.user
    return raw ? (raw as SessionUserWithRole) : null
  })
  const role = computed<InstallRole | null>(() => user.value?.role ?? null)
  const isAdmin = computed(() => role.value === "admin")

  return {
    session,
    user,
    role,
    isAdmin,
    signIn: client.signIn,
    signOut: client.signOut,
  }
}
