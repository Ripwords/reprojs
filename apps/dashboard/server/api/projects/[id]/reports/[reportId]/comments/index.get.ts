// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.get.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../../../../../../db"
import { reportComments } from "../../../../../../db/schema/report-comments"
import { user } from "../../../../../../db/schema/auth-schema"
import { userIdentities } from "../../../../../../db/schema/user-identities"
import { requireProjectRole } from "../../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  await requireProjectRole(event, projectId, "viewer")

  const rows = await db
    .select({
      id: reportComments.id,
      body: reportComments.body,
      source: reportComments.source,
      userId: reportComments.userId,
      githubLogin: reportComments.githubLogin,
      githubCommentId: reportComments.githubCommentId,
      createdAt: reportComments.createdAt,
      updatedAt: reportComments.updatedAt,
      deletedAt: reportComments.deletedAt,
      authorName: user.name,
      authorEmail: user.email,
      authorLinkedHandle: userIdentities.externalHandle,
      authorAvatarUrl: userIdentities.externalAvatarUrl,
    })
    .from(reportComments)
    .leftJoin(user, eq(user.id, reportComments.userId))
    .leftJoin(
      userIdentities,
      and(eq(userIdentities.userId, reportComments.userId), eq(userIdentities.provider, "github")),
    )
    .where(and(eq(reportComments.reportId, reportId), isNull(reportComments.deletedAt)))
    .orderBy(asc(reportComments.createdAt))

  return {
    items: rows.map((r) => ({
      id: r.id,
      body: r.body,
      source: r.source,
      githubCommentId: r.githubCommentId,
      author: r.userId
        ? {
            kind: "dashboard" as const,
            id: r.userId,
            name: r.authorName,
            email: r.authorEmail,
            githubLogin: r.authorLinkedHandle ?? null,
            avatarUrl: r.authorAvatarUrl ?? null,
          }
        : { kind: "github" as const, githubLogin: r.githubLogin, avatarUrl: null },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  }
})
