import { defineEventHandler } from "h3"
import { getGithubAppCredentials } from "../../../lib/github-app-credentials"
import { requireInstallAdmin } from "../../../lib/permissions"

/**
 * Admin-only: report whether this instance has a GitHub App configured, and
 * if so, whether it came from env vars (legacy / dev) or from the in-app
 * manifest flow (DB singleton). Never returns secrets — only public metadata
 * needed to render the settings page.
 */
export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const creds = await getGithubAppCredentials()
  if (!creds) {
    return { configured: false as const }
  }
  return {
    configured: true as const,
    source: creds.source,
    slug: creds.slug,
    appId: creds.appId,
    clientId: creds.clientId,
  }
})
