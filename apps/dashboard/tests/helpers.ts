import { sql } from "drizzle-orm"
import { db } from "../server/db"
import { projects } from "../server/db/schema"

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

export async function truncateDomain() {
  await db.execute(
    sql`TRUNCATE project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
  await db.execute(
    sql`UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1`,
  )
}

export async function createUser(
  email: string,
  role: "admin" | "member" = "member",
): Promise<string> {
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

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
    body: opts.body
      ? typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined,
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

export async function truncateReports() {
  await db.execute(sql`TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE`)
}

export async function seedProject(opts: {
  name: string
  publicKey: string
  allowedOrigins?: string[]
  createdBy: string
}): Promise<string> {
  const [p] = await db
    .insert(projects)
    .values({
      name: opts.name,
      createdBy: opts.createdBy,
      publicKey: opts.publicKey,
      allowedOrigins: opts.allowedOrigins ?? [],
    })
    .returning()
  return p.id
}

export async function truncateGithub() {
  await db.execute(sql`TRUNCATE report_sync_jobs, github_integrations RESTART IDENTITY CASCADE`)
}

export function makePngBlob(): Blob {
  // Minimal valid 1x1 PNG (signature + IHDR + IDAT + IEND)
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10,
    45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
  return new Blob([bytes], { type: "image/png" })
}
