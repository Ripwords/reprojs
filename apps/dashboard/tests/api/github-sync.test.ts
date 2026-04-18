// apps/dashboard/tests/api/github-sync.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { GitHubInstallationClient } from "@feedback-tool/integrations-github"
import { __setClientOverride, signInstallState } from "../../server/lib/github"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_GHUB1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

interface MockCalls {
  createIssue: Array<Record<string, unknown>>
  closeIssue: Array<Record<string, unknown>>
  reopenIssue: Array<Record<string, unknown>>
  updateIssueLabels: Array<Record<string, unknown>>
  getIssue: Array<Record<string, unknown>>
}

export function makeMock(overrides: Partial<GitHubInstallationClient> = {}): {
  client: GitHubInstallationClient
  calls: MockCalls
} {
  const calls: MockCalls = {
    createIssue: [],
    closeIssue: [],
    reopenIssue: [],
    updateIssueLabels: [],
    getIssue: [],
  }
  const defaults: GitHubInstallationClient = {
    createIssue: async (input) => {
      calls.createIssue.push(input as unknown as Record<string, unknown>)
      return { number: 42, nodeId: "NODE_42", url: "https://github.com/acme/frontend/issues/42" }
    },
    getIssue: async (input) => {
      calls.getIssue.push(input as unknown as Record<string, unknown>)
      return { state: "open", labels: [] }
    },
    closeIssue: async (input) => {
      calls.closeIssue.push(input as unknown as Record<string, unknown>)
    },
    reopenIssue: async (input) => {
      calls.reopenIssue.push(input as unknown as Record<string, unknown>)
    },
    updateIssueLabels: async (input) => {
      calls.updateIssueLabels.push(input as unknown as Record<string, unknown>)
    },
    listInstallationRepositories: async () => [
      { id: 1, owner: "acme", name: "frontend", fullName: "acme/frontend" },
    ],
  }
  return { client: { ...defaults, ...overrides }, calls }
}

beforeAll(() => {
  process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "123"
  process.env.GITHUB_APP_PRIVATE_KEY =
    process.env.GITHUB_APP_PRIVATE_KEY ??
    "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
  process.env.GITHUB_APP_WEBHOOK_SECRET =
    process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret"
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
})

describe("github integration — install + config", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("install-callback with valid state upserts github_integrations row", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const state = signInstallState({
      projectId: pid,
      userId: owner,
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const res = await fetch(
      `http://localhost:3000/api/integrations/github/install-callback?installation_id=99&state=${encodeURIComponent(state)}`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(302)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.installationId).toBe(99)
    expect(row?.status).toBe("connected")
  })

  test("install-callback rejects invalid state", async () => {
    const res = await fetch(
      "http://localhost:3000/api/integrations/github/install-callback?installation_id=1&state=bogus.bogus",
      { redirect: "manual" },
    )
    expect(res.status).toBe(401)
  })

  test("PATCH updates repo + defaults", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "", repoName: "" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: {
        repoOwner: "acme",
        repoName: "frontend",
        defaultLabels: ["feedback"],
        defaultAssignees: ["@priya"],
      },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.repoOwner).toBe("acme")
    expect(row?.defaultLabels).toEqual(["feedback"])
  })

  test("disconnect flips status", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
  })

  test("GET config returns the shape with no integration", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ installed: boolean }>(
      `/api/projects/${pid}/integrations/github`,
      { headers: { cookie } },
    )
    expect(body.installed).toBe(false)
  })

  test("viewer cannot PATCH or disconnect", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
    })
    await db.insert(projectMembers).values({ projectId: pid, userId: viewer, role: "viewer" })
    const cookie = await signIn("viewer@example.com")
    const r1 = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: { defaultLabels: ["x"] },
    })
    expect(r1.status).toBe(403)
    const r2 = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r2.status).toBe(403)
  })
})
