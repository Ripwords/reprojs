import { defineEventHandler } from "h3"
import { unlinkGithubIdentity } from "../../../../lib/github-identities"
import { requireSession } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  await unlinkGithubIdentity(session.userId)
  return { ok: true }
})
