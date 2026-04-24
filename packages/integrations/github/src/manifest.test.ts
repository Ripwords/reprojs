import { describe, expect, test } from "bun:test"
import { buildGithubAppManifest } from "./manifest"

describe("buildGithubAppManifest", () => {
  test("uses baseUrl for redirect + callback + webhook URLs on a public domain", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://repro.example.com" })
    expect(m.hook_attributes.url).toBe("https://repro.example.com/api/integrations/github/webhook")
    expect(m.redirect_url).toBe(
      "https://repro.example.com/api/integrations/github/manifest-callback",
    )
    // User-authorization OAuth callback points at better-auth's social callback
    // so the App's clientId/secret can power "Sign in with GitHub".
    expect(m.callback_urls).toContain("https://repro.example.com/api/auth/callback/github")
    // The App-installation setup URL stays on our own handler (distinct hook
    // from the OAuth callback).
    expect(m.setup_url).toBe("https://repro.example.com/api/integrations/github/install-callback")
  })

  test("webhook is created active for public baseUrls — events flow immediately after install", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://repro.example.com" })
    expect(m.hook_attributes.active).toBe(true)
  })

  test("localhost baseUrl uses a public placeholder webhook URL inactive (GitHub rejects localhost)", () => {
    const m = buildGithubAppManifest({ baseUrl: "http://localhost:3000" })
    expect(m.hook_attributes.url).toBe("https://example.com/webhook")
    expect(m.hook_attributes.active).toBe(false)
    expect(m.redirect_url).toBe("http://localhost:3000/api/integrations/github/manifest-callback")
  })

  test("127.0.0.1 also triggers the placeholder", () => {
    const m = buildGithubAppManifest({ baseUrl: "http://127.0.0.1:3000" })
    expect(m.hook_attributes.url).toBe("https://example.com/webhook")
  })

  test("includes issues:write, metadata:read, and emails:read permissions", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.default_permissions.issues).toBe("write")
    expect(m.default_permissions.metadata).toBe("read")
    // emails:read is required by better-auth's GitHub provider; without it
    // the OAuth callback throws email_not_found on first sign-in.
    expect(m.default_permissions.emails).toBe("read")
  })

  test("default_events subscribes to every event the webhook handler dispatches on", () => {
    // installation + installation_repositories are auto-delivered — excluded
    // here (listing them causes GitHub to reject the manifest).
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.default_events).toEqual(["issues", "issue_comment", "label", "milestone", "member"])
  })

  test("setup_on_update true so admins get redirected back after editing installation", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.setup_on_update).toBe(true)
  })

  test("public is true — otherwise non-owner users 404 on Sign in with GitHub", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.public).toBe(true)
  })

  test("name defaults to Repro but is overridable", () => {
    expect(buildGithubAppManifest({ baseUrl: "https://x.test" }).name).toBe("Repro")
    expect(buildGithubAppManifest({ baseUrl: "https://x.test", name: "BugCo Reports" }).name).toBe(
      "BugCo Reports",
    )
  })

  test("strips trailing slash from baseUrl", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test/" })
    expect(m.redirect_url).toBe("https://x.test/api/integrations/github/manifest-callback")
  })

  test("rejects non-https non-localhost baseUrl", () => {
    expect(() => buildGithubAppManifest({ baseUrl: "http://x.test" })).toThrow(/https/i)
  })
})
