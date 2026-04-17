import { defineEventHandler, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { UpdateAppSettingsInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { appSettings } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b: unknown) => UpdateAppSettingsInput.parse(b))

  const [updated] = await db
    .update(appSettings)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(appSettings.id, 1))
    .returning()

  return {
    signupGated: updated.signupGated,
    installName: updated.installName,
    updatedAt: updated.updatedAt.toISOString(),
  }
})
