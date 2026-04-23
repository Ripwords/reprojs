import { defineEventHandler, createError } from "h3"
import { signIdentityState } from "../../../../lib/identity-oauth-state"
import { getGithubAppCredentials } from "../../../../lib/github-app-credentials"
import { requireSession } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)

  const creds = await getGithubAppCredentials()
  if (!creds?.clientId) {
    throw createError({ statusCode: 400, statusMessage: "GitHub App is not configured" })
  }

  const authSecret = process.env.BETTER_AUTH_SECRET
  if (!authSecret) {
    throw createError({ statusCode: 500, statusMessage: "Missing auth secret" })
  }

  const state = signIdentityState({
    userId: session.userId,
    secret: authSecret,
    ttlSeconds: 10 * 60,
  })

  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/me/identities/github/callback`
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize")
  authorizeUrl.searchParams.set("client_id", creds.clientId)
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("scope", "read:user")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)

  return { redirectUrl: authorizeUrl.toString() }
})
