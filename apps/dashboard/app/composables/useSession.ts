import { useAuthClient } from "../lib/auth-client"

export const useSession = () => {
  const client = useAuthClient()
  const session = client.useSession()
  const isAdmin = computed(
    () => (session.value.data?.user as { role?: string } | undefined)?.role === "admin",
  )
  return {
    session,
    isAdmin,
    signIn: client.signIn,
    signOut: client.signOut,
  }
}
