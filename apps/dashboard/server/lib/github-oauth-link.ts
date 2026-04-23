export type GithubOauthUser = {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

export type GithubOauthLinkDeps = {
  clientId: string
  clientSecret: string
  exchangeCode?: (code: string) => Promise<string>
  fetchUser?: (accessToken: string) => Promise<GithubOauthUser>
}

export async function exchangeGithubCodeDefault(
  deps: GithubOauthLinkDeps,
  code: string,
): Promise<string> {
  if (deps.exchangeCode) return deps.exchangeCode(code)
  const res = await $fetch<{ access_token?: string }>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: { client_id: deps.clientId, client_secret: deps.clientSecret, code },
    },
  )
  if (!res.access_token) throw new Error("No access token")
  return res.access_token
}

export async function fetchGithubUserDefault(
  deps: GithubOauthLinkDeps,
  token: string,
): Promise<GithubOauthUser> {
  if (deps.fetchUser) return deps.fetchUser(token)
  return await $fetch<GithubOauthUser>("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Repro-Dashboard",
      authorization: `Bearer ${token}`,
    },
  })
}

let __testOverride: GithubOauthLinkDeps | null = null

export function __setOauthOverride(deps: GithubOauthLinkDeps | null) {
  __testOverride = deps
}

export function __getOauthOverride() {
  return __testOverride
}
