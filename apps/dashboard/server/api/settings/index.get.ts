import { defineEventHandler } from "h3"
import type { AppSettingsDTO } from "@feedback-tool/shared"
import { db } from "../../db"
import { appSettings } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<AppSettingsDTO> => {
  await requireInstallAdmin(event)

  const [settings] = await db.select().from(appSettings).limit(1)

  return {
    signupGated: settings.signupGated,
    allowedEmailDomains: settings.allowedEmailDomains,
    updatedAt: settings.updatedAt.toISOString(),
  }
})
