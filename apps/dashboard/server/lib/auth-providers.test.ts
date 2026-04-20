import { describe, expect, test } from "bun:test"
import { getAuthProviderStatus } from "./auth-providers"

describe("getAuthProviderStatus", () => {
  test("reports github=true when GITHUB_CLIENT_ID is set", () => {
    const status = getAuthProviderStatus({
      GITHUB_CLIENT_ID: "client_123",
      GOOGLE_CLIENT_ID: "",
    })
    expect(status).toEqual({ github: true, google: false })
  })

  test("reports google=true when GOOGLE_CLIENT_ID is set", () => {
    const status = getAuthProviderStatus({
      GITHUB_CLIENT_ID: "",
      GOOGLE_CLIENT_ID: "client_456",
    })
    expect(status).toEqual({ github: false, google: true })
  })

  test("reports both false when neither is set", () => {
    const status = getAuthProviderStatus({ GITHUB_CLIENT_ID: "", GOOGLE_CLIENT_ID: "" })
    expect(status).toEqual({ github: false, google: false })
  })

  test("treats whitespace-only values as unset", () => {
    const status = getAuthProviderStatus({ GITHUB_CLIENT_ID: "   ", GOOGLE_CLIENT_ID: "\t" })
    expect(status).toEqual({ github: false, google: false })
  })
})
