import { buildGithubAppManifest } from "@reprojs/integrations-github"
import { createError, defineEventHandler, getQuery, setHeader } from "h3"
import { env } from "../../../lib/env"
import { signManifestState } from "../../../lib/manifest-state"
import { requireInstallAdmin } from "../../../lib/permissions"

// Rendering an auto-submitting HTML form is the simplest way to drive the
// GitHub App manifest flow: GitHub requires the manifest to arrive as a POST
// body to `github.com/settings/apps/new?state=...`. We can't 302 with a body,
// so we return a minimal HTML page that submits itself on load. A noscript
// fallback is provided for admins with JS disabled (rare but possible).

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  )
}

export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)

  const q = getQuery(event)
  // Optional `org` query parameter scopes creation to a GitHub org instead of
  // the admin's personal account. GitHub validates the org membership itself.
  const org = typeof q.org === "string" && /^[A-Za-z0-9-]+$/.test(q.org) ? q.org : null

  const exp = Math.floor(Date.now() / 1000) + 10 * 60
  const state = signManifestState({ userId: session.userId, exp }, env.BETTER_AUTH_SECRET)

  let manifest
  try {
    manifest = buildGithubAppManifest({ baseUrl: env.BETTER_AUTH_URL })
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "invalid manifest input",
    })
  }
  const manifestJson = JSON.stringify(manifest)

  const action = org
    ? `https://github.com/organizations/${org}/settings/apps/new?state=${encodeURIComponent(state)}`
    : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Creating GitHub App…</title>
    <meta name="referrer" content="no-referrer" />
  </head>
  <body>
    <form id="f" method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="manifest" value="${escapeHtml(manifestJson)}" />
      <noscript>
        <p>Please enable JavaScript, or click the button below to continue.</p>
        <button type="submit">Create GitHub App</button>
      </noscript>
    </form>
    <script>document.getElementById('f').submit();</script>
  </body>
</html>`

  setHeader(event, "content-type", "text/html; charset=utf-8")
  // Prevent caching — state is single-use and short-lived.
  setHeader(event, "cache-control", "no-store")
  return html
})
