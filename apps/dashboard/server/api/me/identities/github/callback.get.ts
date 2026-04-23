import { defineEventHandler, createError, getQuery, sendRedirect } from "h3"
import { verifyIdentityState } from "../../../../lib/identity-oauth-state"
import { upsertGithubIdentity } from "../../../../lib/github-identities"
import { getGithubAppCredentials } from "../../../../lib/github-app-credentials"
import {
  exchangeGithubCodeDefault,
  fetchGithubUserDefault,
  __getOauthOverride,
} from "../../../../lib/github-oauth-link"
import { requireSession } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const query = getQuery(event)
  const code = typeof query.code === "string" ? query.code : null
  const state = typeof query.state === "string" ? query.state : null
  if (!code || !state) {
    throw createError({ statusCode: 400, statusMessage: "Missing code/state" })
  }

  const authSecret = process.env.BETTER_AUTH_SECRET
  if (!authSecret) throw createError({ statusCode: 500, statusMessage: "Missing auth secret" })

  let stateClaim: { userId: string }
  try {
    stateClaim = verifyIdentityState({ state, secret: authSecret })
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid or expired state" })
  }
  if (stateClaim.userId !== session.userId) {
    throw createError({ statusCode: 403, statusMessage: "State does not match session" })
  }

  const creds = await getGithubAppCredentials()
  if (!creds?.clientId || !creds.clientSecret) {
    throw createError({ statusCode: 400, statusMessage: "GitHub App is not configured" })
  }

  const override = __getOauthOverride()
  const deps = override ?? { clientId: creds.clientId, clientSecret: creds.clientSecret }

  const token = await exchangeGithubCodeDefault(deps, code)
  const ghUser = await fetchGithubUserDefault(deps, token)

  try {
    await upsertGithubIdentity(session.userId, {
      externalId: String(ghUser.id),
      externalHandle: ghUser.login,
      externalAvatarUrl: ghUser.avatar_url,
      externalName: ghUser.name,
      externalEmail: ghUser.email,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Link failed"
    return sendRedirect(event, `/settings/identities?error=${encodeURIComponent(message)}`)
  }

  return sendRedirect(event, "/settings/identities?linked=github")
})
