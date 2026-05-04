// apps/dashboard/server/lib/github.ts
import { createHmac, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { createAppAuth, createInstallationClient } from "@reprojs/integrations-github"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import { getGithubAppCredentials } from "./github-app-credentials"

function resolvePrivateKey(raw: string): string {
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n")
  const path = isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
  return readFileSync(path, "utf8")
}

/**
 * Mint a short-lived installation access token for raw HTTP calls that
 * Octokit can't easily express (binary streaming, manual redirect handling).
 * The current consumer is the GitHub user-attachment image proxy — see
 * `server/api/projects/[id]/integrations/github/image-proxy.get.ts`.
 *
 * Throws if the GitHub App is not configured. Returns the bare token; the
 * caller wraps it as `Authorization: Bearer <token>`.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const creds = await getGithubAppCredentials()
  if (!creds) {
    throw new Error("GitHub App is not configured — cannot mint installation token")
  }
  const auth = createAppAuth({
    appId: creds.appId,
    privateKey: resolvePrivateKey(creds.privateKey),
    installationId,
  })
  const result = (await auth({ type: "installation" })) as { token: string }
  return result.token
}

// Test-only override hook: allows integration tests to inject a mock client
// without reaching the Octokit network path. Production callers ignore it.
let overrideFactory: ((installationId: number) => GitHubInstallationClient) | null = null

export function __setClientOverride(
  factory: ((installationId: number) => GitHubInstallationClient) | null,
): void {
  overrideFactory = factory
}

/**
 * True only when a test override is active. Used by the reconciler to
 * decide whether to route through test shims OR go straight to a raw
 * Octokit. Without this check, the reconciler used `typeof client.getIssue
 * === "function"` as the discriminator — which misclassified the real
 * production client (which has `getIssue`) as a facade-only test mock,
 * silently no-op'ing every assignee write through the shim.
 */
export function __hasClientOverride(): boolean {
  return overrideFactory !== null
}

export async function getGithubClient(installationId: number): Promise<GitHubInstallationClient> {
  if (overrideFactory) return overrideFactory(installationId)
  const creds = await getGithubAppCredentials()
  if (!creds) {
    throw new Error(
      "GitHub App is not configured. Set GITHUB_APP_ID/PRIVATE_KEY/WEBHOOK_SECRET or run the in-app manifest setup.",
    )
  }
  return createInstallationClient({
    appId: creds.appId,
    privateKey: resolvePrivateKey(creds.privateKey),
    installationId,
  })
}

export async function getWebhookSecret(): Promise<string> {
  const creds = await getGithubAppCredentials()
  if (!creds) throw new Error("GitHub App is not configured — cannot load webhook secret")
  return creds.webhookSecret
}

// === Install-state signing (used by install-redirect + install-callback) ===

interface InstallStateClaims {
  projectId: string
  userId: string
  exp: number // UNIX seconds
}

export async function signInstallState(claims: InstallStateClaims): Promise<string> {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const secret = await getWebhookSecret() // reuse webhook secret for state HMAC
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export async function verifyInstallState(state: string): Promise<InstallStateClaims | null> {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null
  const secret = await getWebhookSecret()
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  if (expected.length !== sig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { projectId?: unknown }).projectId !== "string" ||
    typeof (parsed as { userId?: unknown }).userId !== "string" ||
    typeof (parsed as { exp?: unknown }).exp !== "number"
  ) {
    return null
  }
  const claims = parsed as InstallStateClaims
  if (claims.exp * 1000 < Date.now()) return null
  return claims
}
