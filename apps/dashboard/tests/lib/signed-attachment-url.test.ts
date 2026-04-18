import { describe, expect, test } from "bun:test"
import { signAttachmentToken, verifyAttachmentToken } from "../../server/lib/signed-attachment-url"

const SECRET = "test-secret-0123456789abcdef"

describe("signed-attachment-url", () => {
  test("token round-trips with matching secret", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(true)
  })

  test("tampered token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r2",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("wrong secret rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: "other-secret",
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("expired token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) - 10
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })
})
