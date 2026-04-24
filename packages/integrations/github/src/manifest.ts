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
// Webhooks: for public baseUrls we ship the manifest with the webhook
// pre-configured AND active (GitHub starts delivering events immediately
// after install). For localhost we can't do that — GitHub refuses both
// blank URLs ("Hook url cannot be blank") and non-public URLs ("not
// reachable over the public Internet") — so we ship a placeholder URL
// inactive. Localhost operators deploy to a real domain, update the URL in
// GitHub App settings, and flip active there.

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
  default_permissions: {
    issues: "write"
    metadata: "read"
    // Account-level permission (GitHub groups it under "Account permissions →
    // Email addresses"). Required so the User-auth OAuth callback can read
    // the signing-in user's verified email — without it better-auth's GitHub
    // provider throws `email_not_found` on first sign-in.
    emails: "read"
  }
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
  // For public baseUrls, pre-fill the webhook URL AND activate it — GitHub
  // will start delivering events as soon as the app is installed. For
  // localhost, ship a placeholder URL inactive; operators update both after
  // deploying to a real domain.
  const localhost = isLocalhost(base)
  const webhookUrl = localhost ? PLACEHOLDER_WEBHOOK_URL : `${base}/api/integrations/github/webhook`
  return {
    name: input.name ?? "Repro",
    url: base,
    hook_attributes: { url: webhookUrl, active: !localhost },
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
    // `public: true` is required for the "Sign in with GitHub" flow to work
    // for anyone other than the App owner. A private GitHub App returns 404
    // on `/login/oauth/authorize` to non-owners — even if they have the
    // clientId and a valid callback URL. The App remains unlisted in
    // Marketplace (that's a separate submission); `public: true` just means
    // any GitHub user can authorize it. Install-time webhooks from random
    // strangers would still hit a dashboard that doesn't have their install
    // context and fail gracefully.
    public: true,
    default_permissions: {
      issues: "write",
      metadata: "read",
      // See interface comment — fixes `email_not_found` on first sign-in
      // when the App's clientId is reused for better-auth GitHub OAuth.
      emails: "read",
    },
    default_events: ["issues"],
  }
}
