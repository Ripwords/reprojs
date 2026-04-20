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
  const envComplete = Boolean(
    e.GITHUB_APP_ID && e.GITHUB_APP_PRIVATE_KEY && e.GITHUB_APP_WEBHOOK_SECRET,
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
// Runtime wrapper: reads env + DB, caches. Invalidated by the manifest-callback
// after a successful write so the next request picks up the new credentials.
// -----------------------------------------------------------------------------

let cache: GithubAppCredentials | null | undefined

export function invalidateGithubAppCache(): void {
  cache = undefined
}

export async function getGithubAppCredentials(): Promise<GithubAppCredentials | null> {
  if (cache !== undefined) return cache
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
  cache = resolveGithubAppCredentials({
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
  return cache
}
