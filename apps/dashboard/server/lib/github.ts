// apps/dashboard/server/lib/github.ts
import { createHmac, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { createInstallationClient } from "@feedback-tool/integrations-github"
import type { GitHubInstallationClient } from "@feedback-tool/integrations-github"
import { env } from "./env"

function resolvePrivateKey(raw: string): string {
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n")
  const path = isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
  return readFileSync(path, "utf8")
}

// Test-only override hook: allows integration tests to inject a mock client
// without reaching the Octokit network path. Production callers ignore it.
let overrideFactory: ((installationId: number) => GitHubInstallationClient) | null = null

export function __setClientOverride(
  factory: ((installationId: number) => GitHubInstallationClient) | null,
): void {
  overrideFactory = factory
}

export function getGithubClient(installationId: number): GitHubInstallationClient {
  if (overrideFactory) return overrideFactory(installationId)
  const appId = env.GITHUB_APP_ID
  const raw = env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !raw) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set")
  }
  return createInstallationClient({ appId, privateKey: resolvePrivateKey(raw), installationId })
}

export function getWebhookSecret(): string {
  const s = env.GITHUB_APP_WEBHOOK_SECRET
  if (!s) throw new Error("GITHUB_APP_WEBHOOK_SECRET must be set")
  return s
}

// === Install-state signing (used by G-18 install-redirect + install-callback) ===

interface InstallStateClaims {
  projectId: string
  userId: string
  exp: number // UNIX seconds
}

export function signInstallState(claims: InstallStateClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const secret = getWebhookSecret() // reuse webhook secret for state HMAC
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyInstallState(state: string): InstallStateClaims | null {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null
  const secret = getWebhookSecret()
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
  // Shape check: HMAC only proves the payload was signed by us, not that it has
  // the expected fields. A future bug that signs a different shape would
  // otherwise silently yield `claims.projectId === undefined`, which would
  // query `WHERE project_id = NULL` (always false) rather than erroring.
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
