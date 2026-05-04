// apps/dashboard/server/api/projects/[id]/integrations/github/image-proxy.get.ts
//
// Proxies GitHub user-attachment image URLs through this origin so they can
// load in the dashboard's comment thread.
//
// Why this exists:
//   GitHub's modern issue-comment image hosting at
//   `https://github.com/user-attachments/assets/<uuid>` is auth-gated. The
//   URL only 302-resolves to a JWT-signed
//   `https://private-user-images.githubusercontent.com/<id>/<uuid>?jwt=...`
//   when the request carries a `_gh_sess` cookie or `Authorization: Bearer
//   <token>`. From a third-party browser tab — i.e. *every* dashboard user —
//   the request 404s. The dashboard would otherwise render a broken-image
//   glyph for every screenshot pasted into a synced GitHub comment.
//
// What we do:
//   1. Validate the requested URL is one of the recognised GitHub asset hosts.
//   2. Mint a short-lived installation access token for the project's
//      GitHub App installation.
//   3. Issue the request with `Authorization: Bearer <token>`,
//      `redirect: "manual"`. GitHub responds 302 with a Location header
//      pointing at a JWT-signed CDN URL.
//   4. Refetch the redirect target *without* the bearer token (the JWT is
//      already part of the URL; forwarding our App token to a different
//      host would leak credentials).
//   5. Stream the bytes back with the upstream Content-Type and a short
//      private cache window.
//
// Threat model:
//   - Auth: requireProjectRole(viewer) — only members of the project that
//     owns the comment can fetch images for that project.
//   - SSRF: URL host is regex-checked against a tight whitelist of GitHub
//     hosts; arbitrary URLs are rejected at step (1).
//   - Token leak: bearer token is dropped before following the 302 to
//     `private-user-images.githubusercontent.com` (different host, JWT in
//     the URL is sufficient auth).
//   - Bandwidth: 10 MiB cap so a malformed/oversized upstream can't be used
//     as an egress amplifier.
//   - Content sniffing: `X-Content-Type-Options: nosniff` + we refuse
//     non-image upstream Content-Types.
import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from "h3"
import { Buffer } from "node:buffer"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getInstallationToken } from "../../../../../lib/github"

const ALLOWED_HOST_RE =
  /^https:\/\/(?:github\.com\/user-attachments\/assets\/|private-user-images\.githubusercontent\.com\/|user-images\.githubusercontent\.com\/)/

const MAX_BYTES = 10 * 1024 * 1024 // 10 MiB

export default defineEventHandler(async (event): Promise<Buffer> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const { url } = getQuery(event) as { url?: string }
  if (!url || typeof url !== "string" || !ALLOWED_HOST_RE.test(url)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid or disallowed URL" })
  }

  const [gi] = await db
    .select({ installationId: githubIntegrations.installationId })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (!gi) {
    throw createError({ statusCode: 404, statusMessage: "GitHub integration not configured" })
  }

  const token = await getInstallationToken(gi.installationId)

  // Step 1: hit the auth-gated GitHub URL with our App token. Manual redirect
  // — we MUST NOT let fetch follow it automatically because that would
  // forward the bearer token to the CDN host.
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Repro-Dashboard-ImageProxy",
      Accept: "image/*,*/*;q=0.8",
    },
    redirect: "manual",
  })

  let final: Response
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location")
    if (!location) {
      throw createError({ statusCode: 502, statusMessage: "Upstream redirect without Location" })
    }
    // Step 2: follow the redirect to the JWT-signed CDN URL, no auth header.
    final = await fetch(location, {
      headers: {
        "User-Agent": "Repro-Dashboard-ImageProxy",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    })
  } else {
    final = upstream
  }

  if (!final.ok) {
    throw createError({ statusCode: final.status, statusMessage: `Upstream ${final.status}` })
  }

  const contentType = final.headers.get("content-type") ?? "application/octet-stream"
  if (!contentType.startsWith("image/")) {
    throw createError({ statusCode: 415, statusMessage: "Upstream is not an image" })
  }

  const buf = Buffer.from(await final.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Image too large" })
  }

  setHeader(event, "Content-Type", contentType)
  // Override the global `/api/**` no-store rule — the proxied bytes are
  // immutable for a given URL (uuids are content-addressed) and re-fetching
  // on every paint hammers GitHub. Private since this is auth-gated content.
  setHeader(event, "Cache-Control", "private, max-age=3600, immutable")
  setHeader(event, "X-Content-Type-Options", "nosniff")
  return buf
})
