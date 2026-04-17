import { sql } from "drizzle-orm"
import { db } from "../server/db"

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

export async function truncateDomain() {
  await db.execute(sql`TRUNCATE project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`)
  await db.execute(sql`UPDATE app_settings SET signup_gated = false, install_name = 'Feedback Tool' WHERE id = 1`)
}

export async function createUser(email: string, role: "admin" | "member" = "member"): Promise<string> {
  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", name: email.split("@")[0] }),
  })
  if (!signUpRes.ok && signUpRes.status !== 422) {
    const text = await signUpRes.text()
    throw new Error(`sign-up failed: ${signUpRes.status} ${text}`)
  }
  // Bypass email verification + set explicit role for tests.
  await db.execute(
    sql`UPDATE "user" SET email_verified = true, role = ${role} WHERE email = ${email}`,
  )
  const rows = await db.execute(sql`SELECT id FROM "user" WHERE email = ${email}`)
  // drizzle returns { rows: [...] } for raw execute in node-postgres adapter
  const firstRow = Array.isArray(rows) ? rows[0] : (rows as { rows: Array<{ id: string }> }).rows[0]
  return (firstRow as { id: string }).id
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  const cookie = res.headers.get("set-cookie") ?? ""
  // Extract just the session cookie part (strip Path, HttpOnly, etc. attributes)
  const match = /([^=]+=[^;]+)/.exec(cookie)
  return match ? match[1] : cookie
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> ?? {}),
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  })
  const text = await res.text()
  let body: T
  try {
    body = JSON.parse(text) as T
  } catch {
    body = text as unknown as T
  }
  return { status: res.status, body }
}
