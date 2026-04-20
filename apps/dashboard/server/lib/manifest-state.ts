import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * State signing for the GitHub App manifest flow. This is distinct from
 * `signInstallState` in `./github` because at manifest-creation time the app
 * itself doesn't exist yet — there's no webhook secret to HMAC against. We use
 * `BETTER_AUTH_SECRET` instead, which is always present.
 *
 * State carries only the originating userId + expiry; the manifest-callback
 * uses userId to credit the `created_by` field on the new app row.
 */

export interface ManifestStateClaims {
  userId: string
  exp: number // UNIX seconds
}

export function signManifestState(claims: ManifestStateClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyManifestState(state: string, secret: string): ManifestStateClaims | null {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null
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
    typeof (parsed as { userId?: unknown }).userId !== "string" ||
    typeof (parsed as { exp?: unknown }).exp !== "number"
  ) {
    return null
  }
  const claims = parsed as ManifestStateClaims
  if (claims.exp * 1000 < Date.now()) return null
  return claims
}
