import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { apiFetch, createUser, signIn, truncateDomain, truncateGithubApp } from "../helpers"
import { db } from "../../server/db"
import { githubApp } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY must be set on the dev server for oauth-credentials tests to encrypt seed rows",
    )
  }
})

describe("GET /api/integrations/github/oauth-credentials", () => {
  afterEach(async () => {
    await truncateGithubApp()
    await truncateDomain()
  })

  test("401 when unauthenticated", async () => {
    const res = await apiFetch("/api/integrations/github/oauth-credentials")
    expect(res.status).toBe(401)
  })

  test("403 when authenticated as non-admin", async () => {
    const userId = await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const res = await apiFetch("/api/integrations/github/oauth-credentials", {
      headers: { cookie },
    })
    expect(res.status).toBe(403)
    expect(userId).toBeTruthy()
  })

  test("404 when admin but no github_app row", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    const res = await apiFetch("/api/integrations/github/oauth-credentials", {
      headers: { cookie },
    })
    expect(res.status).toBe(404)
  })

  test("200 with decrypted credentials, Cache-Control: no-store, audit log emitted", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    await db.insert(githubApp).values({
      id: 1,
      appId: "12345",
      slug: "repro-test",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
      webhookSecret: "whsec-test",
      clientId: "Iv1.testclientid",
      clientSecret: "secret-value-xyz",
      htmlUrl: "https://github.com/apps/repro-test",
      createdBy: adminId,
    })

    const infoSpy = spyOn(console, "info").mockImplementation(() => {})

    const cookie = await signIn("admin@example.com")
    const res = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/api/integrations/github/oauth-credentials`, {
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")

    const body = (await res.json()) as { clientId: string; clientSecret: string }
    expect(body.clientId).toBe("Iv1.testclientid")
    expect(body.clientSecret).toBe("secret-value-xyz")

    const auditCall = infoSpy.mock.calls.find((c) => {
      const arg = c[0]
      return typeof arg === "string" && arg.includes("github_oauth_credential_reveal")
    })
    expect(auditCall).toBeDefined()
    const parsed = JSON.parse(auditCall?.[0] as string)
    expect(parsed.event).toBe("github_oauth_credential_reveal")
    expect(parsed.userId).toBe(adminId)
    expect(typeof parsed.ts).toBe("string")

    infoSpy.mockRestore()
  })
})
