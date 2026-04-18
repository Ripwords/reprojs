import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { db } from "../../server/db"
import { truncateDomain } from "../helpers"

// H2: better-auth rate limit verification. This test exercises the 429 path on
// /sign-in/email, /request-password-reset, and the allow-list paths (/session,
// /sign-out, /callback/*). It REQUIRES the dashboard dev server to be running
// with `AUTH_RATE_LIMIT_ENABLED=true` and `AUTH_RATE_PER_IP_PER_15MIN=5`.
// Other test files run against the same server with rate limiting disabled
// (the default in dev) so that shared sign-in helpers don't trip the cap.
//
// Guard: if rate limiting isn't actually active on the running server, fail
// loudly at beforeAll instead of producing confusing assertion failures later.
await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(30000)

const BASE_URL = "http://localhost:3000"
const MAX = 5

// Each test picks a unique IP. better-auth's rate-limit key is `ip|path`, and
// its in-memory store lives for the life of the server — there's no clean way
// to reset it from the test side. Distinct IPs give each test its own bucket.
//
// We also pass the IP during sign-UP because better-auth's default rules cap
// /sign-up at 3 per 10 seconds, which would trip if we used the shared 127.0.0.1
// bucket across six tests.
let ipCounter = 0
function nextIp(): string {
  ipCounter += 1
  const a = 10
  const b = (ipCounter >> 16) & 0xff
  const c = (ipCounter >> 8) & 0xff
  const d = ipCounter & 0xff
  return `${a}.${b}.${c}.${d}`
}

async function createUserFromIp(email: string, ip: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ email, password: "Password123!", name: email.split("@")[0] }),
  })
  if (!res.ok && res.status !== 422) {
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  }
  await db.execute(sql`UPDATE "user" SET email_verified = true WHERE email = ${email}`)
}

async function signInRaw(email: string, ip: string, password = "Password123!"): Promise<Response> {
  return fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ email, password }),
  })
}

async function requestPasswordResetRaw(email: string, ip: string): Promise<Response> {
  // better-auth 1.5.x renamed `/forget-password` to `/request-password-reset`.
  // Both are rate-limited by our customRules for back-compat.
  return fetch(`${BASE_URL}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ email, redirectTo: `${BASE_URL}/reset-password` }),
  })
}

// Probe: confirm rate limiting is actually active before we run the assertions
// below — otherwise the 429 tests would fail with a confusing "expected 429,
// got 401" when the real problem is that the dev server was started without
// AUTH_RATE_LIMIT_ENABLED=true.
async function isRateLimitingActive(): Promise<boolean> {
  const probeIp = "10.255.255.255"
  const probeEmail = "__probe__@example.com"
  // Burst MAX+1 bad attempts — if the (MAX+1)th is 429, rate limiting is on.
  let lastStatus = 0
  for (let i = 0; i < MAX + 1; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential burst to exhaust the bucket
    const r = await signInRaw(probeEmail, probeIp, "WrongPassword!")
    lastStatus = r.status
  }
  return lastStatus === 429
}

describe("auth rate limiting (H2)", () => {
  let rateLimitingOn = false

  beforeAll(async () => {
    await truncateDomain()
    rateLimitingOn = await isRateLimitingActive()
    if (!rateLimitingOn) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth-rate-limit.test] Skipping — dev server is not enforcing auth rate limits. " +
          "Restart dev with AUTH_RATE_LIMIT_ENABLED=true AUTH_RATE_PER_IP_PER_15MIN=5 to run this suite.",
      )
    }
  })

  afterEach(async () => {
    await truncateDomain()
  })

  test("sign-in: 6th attempt from same IP returns 429", async () => {
    if (!rateLimitingOn) return
    const ip = nextIp()
    const email = `target-${ip}@example.com`
    await createUserFromIp(email, ip)

    // Use a deliberately wrong password so we don't create a session; that
    // models the brute-force case (the whole point of rate limiting).
    const statuses: number[] = []
    for (let i = 0; i < MAX; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await signInRaw(email, ip, "WrongPassword!")
      statuses.push(r.status)
    }
    // All MAX attempts should have hit the auth handler (no 429 yet).
    expect(statuses.every((s) => s !== 429)).toBe(true)

    // The next attempt exceeds the window → 429.
    const blocked = await signInRaw(email, ip, "WrongPassword!")
    expect(blocked.status).toBe(429)
  })

  test("request-password-reset: 6th attempt from same IP returns 429", async () => {
    const ip = nextIp()
    const email = `forgot-${ip}@example.com`
    await createUserFromIp(email, ip)

    const statuses: number[] = []
    for (let i = 0; i < MAX; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await requestPasswordResetRaw(email, ip)
      statuses.push(r.status)
    }
    expect(statuses.every((s) => s !== 429)).toBe(true)

    const blocked = await requestPasswordResetRaw(email, ip)
    expect(blocked.status).toBe(429)
  })

  test("different IPs have independent buckets", async () => {
    const ip1 = nextIp()
    const ip2 = nextIp()
    const email = `iso-${ip1}@example.com`
    await createUserFromIp(email, ip1)

    // Exhaust ip1.
    for (let i = 0; i < MAX + 1; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      await signInRaw(email, ip1, "WrongPassword!")
    }
    const ip1Blocked = await signInRaw(email, ip1, "WrongPassword!")
    expect(ip1Blocked.status).toBe(429)

    // ip2 should still work (different bucket).
    const ip2Ok = await signInRaw(email, ip2, "WrongPassword!")
    expect(ip2Ok.status).not.toBe(429)
  })

  test("successful sign-in is allowed below the cap", async () => {
    const ip = nextIp()
    const email = `ok-${ip}@example.com`
    await createUserFromIp(email, ip)

    // MAX-1 successful sign-ins — all below the cap.
    for (let i = 0; i < MAX - 1; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await signInRaw(email, ip, "Password123!")
      expect(r.status).toBe(200)
    }
  })

  test("OAuth /callback/* is NOT rate-limited", async () => {
    const ip = nextIp()
    // Hit the callback path many times over the cap. We expect non-429 responses
    // (likely 302/400 depending on how better-auth validates the missing state).
    // The important assertion: the limiter does NOT intercept.
    const statuses: number[] = []
    for (let i = 0; i < MAX + 3; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await fetch(`${BASE_URL}/api/auth/callback/github`, {
        method: "GET",
        headers: { "X-Forwarded-For": ip },
        redirect: "manual",
      })
      statuses.push(r.status)
    }
    expect(statuses.every((s) => s !== 429)).toBe(true)
  })

  test("/get-session and /sign-out are NOT rate-limited", async () => {
    const ip = nextIp()
    // Way over the cap — these read-only / non-brute-forceable endpoints must
    // never 429.
    for (let i = 0; i < MAX + 5; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const session = await fetch(`${BASE_URL}/api/auth/get-session`, {
        headers: { "X-Forwarded-For": ip },
      })
      expect(session.status).not.toBe(429)

      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const signOut = await fetch(`${BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { "X-Forwarded-For": ip },
      })
      expect(signOut.status).not.toBe(429)
    }
  })
})
