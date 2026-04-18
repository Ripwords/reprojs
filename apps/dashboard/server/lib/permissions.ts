import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { createError } from "h3"
import { db } from "../db"
import { projectMembers } from "../db/schema"
import { auth } from "./auth"

export type ProjectRoleName = "viewer" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  developer: 2,
  owner: 3,
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

export async function requireSession(event: H3Event): Promise<AppSession> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" })
  }
  // better-auth's inferred session.user type doesn't carry our `additionalFields`
  // (role/status), so cast to the shape we configured in auth.ts.
  const u = session.user as unknown as {
    id: string
    email: string
    role: "admin" | "member"
    status: "active" | "invited" | "disabled"
  }
  if (u.status === "disabled") {
    throw createError({ statusCode: 403, statusMessage: "Account disabled" })
  }
  return { userId: u.id, email: u.email, role: u.role, status: u.status }
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
