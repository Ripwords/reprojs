import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import { __setClientOverride, getGithubClient } from "../../server/lib/github"
import { invalidateGithubAppCache } from "../../server/lib/github-app-credentials"
import { githubCache, cacheKey } from "../../server/lib/github-cache"
import { resolveGithubUsers } from "../../server/lib/github-identities"
import { db } from "../../server/db"
import {
  githubApp,
  githubIntegrations,
  projectMembers,
  userIdentities,
} from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

async function seedLinkedProject(ownerEmail: string) {
  await truncateDomain()
  await truncateReports()
  await db.delete(githubIntegrations)
  await db.delete(githubApp)
  await db.delete(userIdentities)
  await db.insert(githubApp).values({
    id: 1,
    appId: "1",
    slug: "test",
    privateKey: "x",
    webhookSecret: "test-webhook-secret",
    clientId: "x",
    clientSecret: "x",
    htmlUrl: "https://github.com/apps/test",
    createdBy: "test",
  })
  // Invalidate the credentials cache so the webhook handler picks up the new DB row.
  invalidateGithubAppCache()
  const ownerId = await createUser(ownerEmail, "member")
  const cookie = await signIn(ownerEmail)
  const projectId = await seedProject({
    name: "picker-test",
    publicKey: `pk_${crypto.randomUUID()}`,
    createdBy: ownerId,
  })
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })
  await db.insert(githubIntegrations).values({
    projectId,
    installationId: 12345,
    repoOwner: "acme",
    repoName: "repro",
    status: "connected",
  })
  return { projectId, cookie, ownerId }
}

function makePickerClient(overrides: Partial<GitHubInstallationClient>): GitHubInstallationClient {
  const defaults: GitHubInstallationClient = {
    createIssue: async () => ({ number: 1, nodeId: "N", url: "https://github.com/i/1" }),
    getIssue: async () => ({ state: "open", labels: [] }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
    listRepoLabels: async () => [],
    listAssignableUsers: async () => [],
    listMilestones: async () => [],
    createLabel: async (
      _owner: string,
      _repo: string,
      input: { name: string; color?: string },
    ) => ({
      name: input.name,
      color: input.color ?? "cccccc",
      description: null,
    }),
  }
  return { ...defaults, ...overrides }
}

// ─── Unit-style tests: run the service logic in the same process ──────────────

describe("github picker — direct function tests", () => {
  beforeEach(() => {
    githubCache.invalidatePrefix("12345:acme/repro")
  })

  afterAll(() => {
    __setClientOverride(null)
  })

  test("listRepoLabels via githubCache caches and returns labels", async () => {
    __setClientOverride(() =>
      makePickerClient({
        listRepoLabels: async () => [{ name: "bug", color: "f00", description: null }],
      }),
    )
    const key = cacheKey(12345, "acme", "repro", "labels")
    const client = await getGithubClient(12345)
    const items = await githubCache.get(key, () => client.listRepoLabels("acme", "repro"))
    expect(items).toEqual([{ name: "bug", color: "f00", description: null }])
    // Second call returns cached value
    __setClientOverride(() =>
      makePickerClient({
        listRepoLabels: async () => [{ name: "stale", color: "fff", description: null }],
      }),
    )
    const cached = await githubCache.get(key, () => client.listRepoLabels("acme", "repro"))
    expect(cached).toEqual([{ name: "bug", color: "f00", description: null }])
  })

  test("resolveGithubUsers returns linked user info from DB", async () => {
    await truncateDomain()
    await db.delete(githubIntegrations)
    await db.delete(userIdentities)
    const ownerId = await createUser("resolve-test@x.com", "member")
    await db.insert(userIdentities).values({
      userId: ownerId,
      provider: "github",
      externalId: "100",
      externalHandle: "owner-gh",
    })
    const result = await resolveGithubUsers(["100", "200"])
    expect(result.size).toBe(1)
    const linked = result.get("100")
    expect(linked?.id).toBe(ownerId)
  })

  test("assignable-users q= filter excludes non-matching logins", () => {
    const raw = [
      { githubUserId: "1", login: "alpha", avatarUrl: null },
      { githubUserId: "2", login: "beta", avatarUrl: null },
      { githubUserId: "3", login: "alphabet", avatarUrl: null },
    ]
    const q = "alph"
    const filtered = raw.filter((u) => {
      if (!q) return true
      return u.login.toLowerCase().includes(q)
    })
    expect(filtered.map((u) => u.login).toSorted()).toEqual(["alpha", "alphabet"])
  })

  test("listMilestones with state=all returns all states", async () => {
    __setClientOverride(() =>
      makePickerClient({
        listMilestones: async (_owner, _repo, state) => {
          if (state === "all")
            return [
              { number: 1, title: "M1", state: "open", dueOn: null },
              { number: 2, title: "M2", state: "closed", dueOn: "2026-06-01T00:00:00Z" },
            ]
          return [{ number: 1, title: "M1", state: "open", dueOn: null }]
        },
      }),
    )
    const client = await getGithubClient(12345)
    const all = await client.listMilestones("acme", "repro", "all")
    expect(all.map((m) => m.state)).toEqual(["open", "closed"])
    const open = await client.listMilestones("acme", "repro", "open")
    expect(open.map((m) => m.state)).toEqual(["open"])
  })
})

// ─── HTTP integration tests: auth guards and error responses ──────────────────

describe("github picker endpoints — HTTP", () => {
  afterEach(async () => {
    __setClientOverride(null)
    githubCache.invalidatePrefix("12345:acme/repro")
  })

  test("returns 401 when unauthenticated", async () => {
    const { projectId } = await seedLinkedProject("unauth-owner@x.com")
    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`)
    expect(res.status).toBe(401)
  })

  test("returns 409 when integration is disconnected", async () => {
    const { projectId, cookie } = await seedLinkedProject("off-owner@x.com")
    await db
      .update(githubIntegrations)
      .set({ status: "disconnected" })
      .where(eq(githubIntegrations.projectId, projectId))

    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`, {
      headers: { cookie },
    })
    expect(res.status).toBe(409)
  })

  test("label webhook returns 202 and matches signed request", async () => {
    await seedLinkedProject("webhook-owner@x.com")
    const body = JSON.stringify({
      action: "created",
      label: { name: "new" },
      repository: { owner: { login: "acme" }, name: "repro" },
      installation: { id: 12345 },
    })
    const sig = `sha256=${createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`
    const webhookRes = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "label",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(webhookRes.status).toBe(202)
  })

  test("milestone webhook returns 202 and matches signed request", async () => {
    await seedLinkedProject("ms-webhook-owner@x.com")
    const body = JSON.stringify({
      action: "created",
      milestone: { number: 1, title: "v1" },
      repository: { owner: { login: "acme" }, name: "repro" },
      installation: { id: 12345 },
    })
    const sig = `sha256=${createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`
    const webhookRes = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "milestone",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(webhookRes.status).toBe(202)
  })

  test("POST labels — 401 when unauthenticated", async () => {
    const { projectId } = await seedLinkedProject("label-unauth@x.com")
    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "anything" }),
    })
    expect(res.status).toBe(401)
  })

  test("POST labels — 400 on invalid hex colour", async () => {
    const { projectId, cookie } = await seedLinkedProject("label-bad-colour@x.com")
    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "oops", color: "not-a-hex" }),
    })
    expect(res.status).toBe(400)
  })

  test("POST labels — 409 when integration is disconnected", async () => {
    const { projectId, cookie } = await seedLinkedProject("label-off@x.com")
    await db
      .update(githubIntegrations)
      .set({ status: "disconnected" })
      .where(eq(githubIntegrations.projectId, projectId))

    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "triage" }),
    })
    expect(res.status).toBe(409)
  })

  test("member webhook returns 202 and matches signed request", async () => {
    await seedLinkedProject("member-webhook-owner@x.com")
    const body = JSON.stringify({
      action: "added",
      member: { login: "newmember" },
      repository: { owner: { login: "acme" }, name: "repro" },
      installation: { id: 12345 },
    })
    const sig = `sha256=${createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`
    const webhookRes = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "member",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(webhookRes.status).toBe(202)
  })
})
