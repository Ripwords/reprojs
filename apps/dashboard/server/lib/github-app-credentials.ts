import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubApp } from "../db/schema"
import { env } from "./env"

export interface GithubAppCredentials {
  appId: string
  slug: string
  privateKey: string
  webhookSecret: string
  clientId: string
  clientSecret: string
  source: "env" | "db"
}

interface EnvCredsShape {
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_APP_WEBHOOK_SECRET: string
  GITHUB_APP_SLUG: string
  GITHUB_APP_CLIENT_ID: string
  GITHUB_APP_CLIENT_SECRET: string
}

interface DbCredsShape {
  appId: string
  slug: string
  privateKey: string
  webhookSecret: string
  clientId: string
  clientSecret: string
}

/**
 * Pure resolver — tested in isolation. Reads from env if the three core secrets
 * (app id, private key, webhook secret) are all present; otherwise falls back
 * to the DB row; otherwise null.
 *
 * `source` on the return value tells callers where the creds came from — useful
 * for the admin UI ("using env-var config" vs "using in-app config").
 */
export function resolveGithubAppCredentials(input: {
  env: EnvCredsShape
  dbRow: DbCredsShape | null
}): GithubAppCredentials | null {
  const e = input.env
  // The user-identity OAuth flow (POST /api/me/identities/github/start) needs
  // clientId + clientSecret on top of the webhook/install triplet. Only treat
  // env as authoritative when ALL five are present — otherwise fall through to
  // the DB row, which the manifest-install flow always populates fully.
  // Without this guard, CI environments that happen to set the webhook triplet
  // but not the OAuth pair would shadow a perfectly valid DB row and surface
  // an empty client_id in the GitHub authorize URL.
  const envComplete = Boolean(
    e.GITHUB_APP_ID &&
    e.GITHUB_APP_PRIVATE_KEY &&
    e.GITHUB_APP_WEBHOOK_SECRET &&
    e.GITHUB_APP_CLIENT_ID &&
    e.GITHUB_APP_CLIENT_SECRET,
  )
  if (envComplete) {
    return {
      appId: e.GITHUB_APP_ID,
      slug: e.GITHUB_APP_SLUG,
      privateKey: e.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      webhookSecret: e.GITHUB_APP_WEBHOOK_SECRET,
      clientId: e.GITHUB_APP_CLIENT_ID,
      clientSecret: e.GITHUB_APP_CLIENT_SECRET,
      source: "env",
    }
  }
  if (input.dbRow) {
    return { ...input.dbRow, source: "db" }
  }
  return null
}

// -----------------------------------------------------------------------------
// Runtime wrapper: reads env + DB on every call.
//
// An in-process cache used to live here, invalidated by the manifest-callback
// + delete-app endpoints. That caused cross-process consistency bugs for
// integration tests that seed the `github_app` row directly (the test process
// could invalidate its own copy, but the running dev-server process kept its
// stale cache until a local write route fired). The backing query is a
// single-row indexed SELECT — cheap enough to run every time.
// -----------------------------------------------------------------------------

/** @deprecated Credentials are no longer cached; this is a no-op kept for API compatibility. */
export function invalidateGithubAppCache(): void {
  // intentionally empty — see comment above
}

export async function getGithubAppCredentials(): Promise<GithubAppCredentials | null> {
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 1)).limit(1)
  const dbRow = row
    ? {
        appId: row.appId,
        slug: row.slug,
        privateKey: row.privateKey,
        webhookSecret: row.webhookSecret,
        clientId: row.clientId,
        clientSecret: row.clientSecret,
      }
    : null
  return resolveGithubAppCredentials({
    env: {
      GITHUB_APP_ID: env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_WEBHOOK_SECRET: env.GITHUB_APP_WEBHOOK_SECRET,
      GITHUB_APP_SLUG: env.GITHUB_APP_SLUG,
      GITHUB_APP_CLIENT_ID: env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_SECRET: env.GITHUB_APP_CLIENT_SECRET,
    },
    dbRow,
  })
}
