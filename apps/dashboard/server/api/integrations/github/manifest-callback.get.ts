import { createError, defineEventHandler, getQuery, sendRedirect } from "h3"
import { sql } from "drizzle-orm"
import { db } from "../../../db"
import { githubApp } from "../../../db/schema"
import { env } from "../../../lib/env"
import { invalidateGithubAppCache } from "../../../lib/github-app-credentials"
import { verifyManifestState } from "../../../lib/manifest-state"
import { requireInstallAdmin } from "../../../lib/permissions"

// Shape of the response from GitHub's app-manifest conversion endpoint.
// Docs: https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest
interface ManifestConversionResponse {
  id: number
  slug: string
  client_id: string
  client_secret: string
  webhook_secret: string
  pem: string
  html_url: string
}

export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)

  const q = getQuery(event)
  const code = typeof q.code === "string" ? q.code : null
  const stateRaw = typeof q.state === "string" ? q.state : null

  if (!code) throw createError({ statusCode: 400, statusMessage: "missing code" })
  if (!stateRaw) throw createError({ statusCode: 400, statusMessage: "missing state" })

  const claims = verifyManifestState(stateRaw, env.BETTER_AUTH_SECRET)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: "invalid or expired state" })
  }
  // Bind the code exchange to the same admin that initiated the flow. Without
  // this check, any admin signed into the dashboard could complete a manifest
  // flow started by another admin and claim `connectedBy`.
  if (claims.userId !== session.userId) {
    throw createError({ statusCode: 403, statusMessage: "state/session user mismatch" })
  }

  // Exchange the code with GitHub. Codes are single-use and TTL ~1h — if the
  // admin refreshed the page after the flow completed once, we surface a
  // friendly 409 instead of a raw upstream error.
  const res = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2026-03-10",
      },
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const status = res.status === 404 ? 409 : 502
    throw createError({
      statusCode: status,
      statusMessage:
        status === 409
          ? "GitHub manifest code already used or expired — start over"
          : `GitHub manifest exchange failed (${res.status}): ${body.slice(0, 200)}`,
    })
  }

  const data = (await res.json()) as ManifestConversionResponse
  if (!env.ENCRYPTION_KEY) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "ENCRYPTION_KEY is not set — cannot store GitHub App credentials. Generate one with: openssl rand -base64 32",
    })
  }

  // Upsert the singleton. `encryptedText` wraps private_key / webhook_secret /
  // client_secret at the Drizzle layer, so we pass plaintext here.
  await db
    .insert(githubApp)
    .values({
      id: 1,
      appId: String(data.id),
      slug: data.slug,
      privateKey: data.pem,
      webhookSecret: data.webhook_secret,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      htmlUrl: data.html_url,
      createdBy: session.userId,
    })
    .onConflictDoUpdate({
      target: githubApp.id,
      set: {
        appId: String(data.id),
        slug: data.slug,
        privateKey: data.pem,
        webhookSecret: data.webhook_secret,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        htmlUrl: data.html_url,
        createdBy: session.userId,
        updatedAt: sql`now()`,
      },
    })

  invalidateGithubAppCache()

  return sendRedirect(event, `${env.BETTER_AUTH_URL}/settings/github?created=1`, 302)
})
