import { describe, expect, test } from "bun:test"
import { resolveGithubAppCredentials } from "../../server/lib/github-app-credentials"

const ENV_CREDS = {
  GITHUB_APP_ID: "111",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nENV\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_WEBHOOK_SECRET: "whsec_env",
  GITHUB_APP_SLUG: "repro-env",
  GITHUB_APP_CLIENT_ID: "Iv1.env",
  GITHUB_APP_CLIENT_SECRET: "cs_env",
}

const DB_CREDS = {
  appId: "222",
  slug: "repro-db",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nDB\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "whsec_db",
  clientId: "Iv1.db",
  clientSecret: "cs_db",
}

describe("resolveGithubAppCredentials", () => {
  test("prefers env when all core env vars are set", () => {
    const out = resolveGithubAppCredentials({ env: ENV_CREDS, dbRow: DB_CREDS })
    expect(out).toEqual({
      appId: "111",
      slug: "repro-env",
      privateKey: ENV_CREDS.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: "whsec_env",
      clientId: "Iv1.env",
      clientSecret: "cs_env",
      source: "env",
    })
  })

  test("falls back to DB row when env is empty", () => {
    const out = resolveGithubAppCredentials({
      env: {
        GITHUB_APP_ID: "",
        GITHUB_APP_PRIVATE_KEY: "",
        GITHUB_APP_WEBHOOK_SECRET: "",
        GITHUB_APP_SLUG: "repro",
        GITHUB_APP_CLIENT_ID: "",
        GITHUB_APP_CLIENT_SECRET: "",
      },
      dbRow: DB_CREDS,
    })
    expect(out).toEqual({ ...DB_CREDS, source: "db" })
  })

  test("falls back to DB when env is partially set (missing private key)", () => {
    // Partial env is a misconfiguration; rather than erroring we treat it as
    // "env not configured" so the DB row can take over. An operator who sets
    // GITHUB_APP_ID but forgets the private key would otherwise be stuck.
    const out = resolveGithubAppCredentials({
      env: { ...ENV_CREDS, GITHUB_APP_PRIVATE_KEY: "" },
      dbRow: DB_CREDS,
    })
    expect(out?.source).toBe("db")
    expect(out?.appId).toBe("222")
  })

  test("returns null when neither env nor DB has creds", () => {
    const out = resolveGithubAppCredentials({
      env: {
        GITHUB_APP_ID: "",
        GITHUB_APP_PRIVATE_KEY: "",
        GITHUB_APP_WEBHOOK_SECRET: "",
        GITHUB_APP_SLUG: "",
        GITHUB_APP_CLIENT_ID: "",
        GITHUB_APP_CLIENT_SECRET: "",
      },
      dbRow: null,
    })
    expect(out).toBeNull()
  })

  test("handles literal-newline-escaped private keys from env (single-line .env files)", () => {
    const out = resolveGithubAppCredentials({
      env: {
        ...ENV_CREDS,
        GITHUB_APP_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\\nLINE\\n-----END RSA PRIVATE KEY-----",
      },
      dbRow: null,
    })
    expect(out?.privateKey).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nLINE\n-----END RSA PRIVATE KEY-----",
    )
  })
})
