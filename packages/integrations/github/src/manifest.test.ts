import { describe, expect, test } from "bun:test"
import { buildGithubAppManifest } from "./manifest"

describe("buildGithubAppManifest", () => {
  test("uses baseUrl for redirect + callback + webhook URLs on a public domain", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://repro.example.com" })
    expect(m.hook_attributes.url).toBe("https://repro.example.com/api/integrations/github/webhook")
    expect(m.redirect_url).toBe(
      "https://repro.example.com/api/integrations/github/manifest-callback",
    )
    expect(m.callback_urls).toContain(
      "https://repro.example.com/api/integrations/github/install-callback",
    )
  })

  test("webhook is created inactive — operators enable it manually after setup", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://repro.example.com" })
    expect(m.hook_attributes.active).toBe(false)
  })

  test("localhost baseUrl uses a public placeholder webhook URL (GitHub rejects localhost)", () => {
    const m = buildGithubAppManifest({ baseUrl: "http://localhost:3000" })
    expect(m.hook_attributes.url).toBe("https://example.com/webhook")
    expect(m.hook_attributes.active).toBe(false)
    expect(m.redirect_url).toBe("http://localhost:3000/api/integrations/github/manifest-callback")
  })

  test("127.0.0.1 also triggers the placeholder", () => {
    const m = buildGithubAppManifest({ baseUrl: "http://127.0.0.1:3000" })
    expect(m.hook_attributes.url).toBe("https://example.com/webhook")
  })

  test("includes issues:write and metadata:read permissions", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.default_permissions.issues).toBe("write")
    expect(m.default_permissions.metadata).toBe("read")
  })

  test("default_events contains issues only (installation* events are auto-delivered)", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.default_events).toEqual(["issues"])
  })

  test("setup_on_update true so admins get redirected back after editing installation", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.setup_on_update).toBe(true)
  })

  test("public is false — each self-hoster's app stays private to their org", () => {
    const m = buildGithubAppManifest({ baseUrl: "https://x.test" })
    expect(m.public).toBe(false)
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
