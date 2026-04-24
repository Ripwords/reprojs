import { defineEventHandler } from "h3"
import { db } from "../../../db"
import { userIdentities } from "../../../db/schema/user-identities"
import { requireSession } from "../../../lib/permissions"
import { eq } from "drizzle-orm"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const rows = await db
    .select({
      provider: userIdentities.provider,
      externalHandle: userIdentities.externalHandle,
      externalAvatarUrl: userIdentities.externalAvatarUrl,
      externalName: userIdentities.externalName,
      linkedAt: userIdentities.linkedAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, session.userId))
  return { items: rows }
})
