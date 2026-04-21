import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { createError } from "h3"
import { db } from "../db"
import { projectMembers } from "../db/schema"
import { auth } from "./auth"

export type ProjectRoleName = "viewer" | "manager" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  manager: 2,
  developer: 3,
  owner: 4,
}

export function compareRole(actual: ProjectRoleName, min: ProjectRoleName): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min]
}

export interface AppSession {
  userId: string
  email: string
  role: "admin" | "member"
  status: "active" | "invited" | "disabled"
}

// Type-level: better-auth's $Infer surfaces the full user shape including our
// configured `additionalFields` (role/status). getSession()'s return type, for
// reasons internal to better-auth, narrows to the core fields only — but the
// runtime value IS the full shape. Bridge with a type assertion against the
// $Infer type (which is authoritative, driven by auth.ts). If auth.ts ever
// renames a field, TypeScript catches the drift here instead of silently
// producing `undefined` at the usage site.
type InferredUser = typeof auth.$Infer.Session.user

export async function requireSession(event: H3Event): Promise<AppSession> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" })
  }
  const u = session.user as InferredUser
  if (u.status === "disabled") {
    throw createError({ statusCode: 403, statusMessage: "Account disabled" })
  }
  return {
    userId: u.id,
    email: u.email,
    role: u.role as AppSession["role"],
    status: u.status as AppSession["status"],
  }
}

export async function requireInstallAdmin(event: H3Event): Promise<AppSession> {
  const session = await requireSession(event)
  if (session.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Admin only" })
  }
  return session
}

export async function requireProjectRole(
  event: H3Event,
  projectId: string,
  min: ProjectRoleName,
): Promise<{ session: AppSession; effectiveRole: ProjectRoleName }> {
  const session = await requireSession(event)
  if (session.role === "admin") {
    return { session, effectiveRole: "owner" }
  }
  const [member] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, session.userId)))
    .limit(1)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }
  if (!compareRole(member.role as ProjectRoleName, min)) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient role" })
  }
  return { session, effectiveRole: member.role as ProjectRoleName }
}
