import { defineEventHandler } from "h3"
import { env } from "../../lib/env"
import { getAuthProviderStatus, type AuthProviderStatus } from "../../lib/auth-providers"

/**
 * Public read-only endpoint returning which OAuth providers are enabled on
 * this deployment. Called by the sign-in page to decide which buttons to
 * render. Evaluates env at request time — the build-time-baked
 * `runtimeConfig.public.hasGithubOAuth` it replaces was broken for
 * pre-built Docker images where the env wasn't set at docker-build time.
 */
export default defineEventHandler((): AuthProviderStatus => {
  return getAuthProviderStatus({
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  })
})
