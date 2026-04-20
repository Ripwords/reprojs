// packages/integrations/github/src/manifest.ts
//
// Builds the GitHub App manifest JSON that self-hosters POST to
// `github.com/settings/apps/new?state=...`. GitHub then creates the app on
// the operator's account with the URLs below baked in, and redirects to
// `redirect_url` with a one-time `code` that the dashboard exchanges for
// the app's private key, webhook secret, and client credentials via
// `POST https://api.github.com/app-manifests/:code/conversions`.
//
// Shared between the dashboard (in-app wizard) and the docs site (bootstrap
// page) so the two flows can't drift.
//
// Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
//
// Webhooks are created DISABLED (hook_attributes.active = false). GitHub
// refuses both blank URLs ("Hook url cannot be blank") and non-public URLs
// ("not reachable over the public Internet"), so we always supply a valid-
// looking URL but ship it inactive. Operators enable two-way sync manually
// from their GitHub App settings page once the instance is deployed. See
// docs/self-hosting/github-app.md.

const PLACEHOLDER_WEBHOOK_URL = "https://example.com/webhook"

export interface GithubAppManifest {
  name: string
  url: string
  hook_attributes: { url: string; active: boolean }
  redirect_url: string
  callback_urls: string[]
  setup_url: string
  setup_on_update: boolean
  public: boolean
  default_permissions: { issues: "write"; metadata: "read" }
  /**
   * Only permission-gated events belong here. `installation` and
   * `installation_repositories` are auto-delivered to every GitHub App and
   * must NOT be listed.
   */
  default_events: Array<"issues">
}

function isLocalhost(base: string): boolean {
  return (
    base.startsWith("http://localhost") ||
    base.startsWith("https://localhost") ||
    base.startsWith("http://127.0.0.1") ||
    base.startsWith("https://127.0.0.1")
  )
}

export function buildGithubAppManifest(input: {
  baseUrl: string
  name?: string
}): GithubAppManifest {
  const base = input.baseUrl.replace(/\/$/, "")
  if (!base.startsWith("https://") && !isLocalhost(base)) {
    throw new Error(`GitHub App manifest requires an https:// baseUrl (got: ${input.baseUrl})`)
  }
  // For public baseUrls, pre-fill the webhook URL so operators only need to
  // toggle active=true in GitHub. For localhost, use a placeholder — operators
  // both update the URL AND toggle active after deploying to a real domain.
  const webhookUrl = isLocalhost(base)
    ? PLACEHOLDER_WEBHOOK_URL
    : `${base}/api/integrations/github/webhook`
  return {
    name: input.name ?? "Repro",
    url: base,
    hook_attributes: { url: webhookUrl, active: false },
    redirect_url: `${base}/api/integrations/github/manifest-callback`,
    // `callback_urls` is the GitHub App's User authorization OAuth callback —
    // where GitHub redirects after "Sign in with GitHub" consent. Point it at
    // better-auth's social-provider callback so the same App's clientId/secret
    // can power dashboard sign-in (via the reveal-credentials flow). The
    // distinct App *installation* callback (`setup_url`) stays on our own
    // handler, which exchanges the install for a `github_integrations` row.
    callback_urls: [`${base}/api/auth/callback/github`],
    setup_url: `${base}/api/integrations/github/install-callback`,
    setup_on_update: true,
    public: false,
    default_permissions: { issues: "write", metadata: "read" },
    default_events: ["issues"],
  }
}
