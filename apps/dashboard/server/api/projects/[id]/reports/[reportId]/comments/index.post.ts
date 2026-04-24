// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readValidatedBody,
  setResponseStatus,
} from "h3"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../../db"
import { reportComments } from "../../../../../../db/schema/report-comments"
import { reports } from "../../../../../../db/schema/reports"
import { githubIntegrations } from "../../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { publishReportStream } from "../../../../../../lib/report-events-bus"
import { enqueueCommentUpsert } from "../../../../../../lib/enqueue-sync"

const CreateCommentBody = z.object({
  body: z.string().min(1).max(65_536),
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })

  const { session } = await requireProjectRole(event, projectId, "manager")
  const body = await readValidatedBody(event, (b) => CreateCommentBody.parse(b))

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
  if (!report || report.projectId !== projectId) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }

  const [inserted] = await db
    .insert(reportComments)
    .values({
      reportId,
      userId: session.userId,
      body: body.body,
      source: "dashboard",
    })
    .returning()

  // Enqueue sync if report is linked to a GitHub issue and integration is connected
  if (report.githubIssueNumber !== null) {
    const [integration] = await db
      .select({ status: githubIntegrations.status })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, projectId))
      .limit(1)

    if (integration?.status === "connected") {
      await enqueueCommentUpsert(reportId, inserted.id)
    }
  }

  publishReportStream(reportId, {
    kind: "comment_added",
    payload: { commentId: inserted.id },
  })

  setResponseStatus(event, 201)
  return { comment: inserted }
})
