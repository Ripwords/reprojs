import { createError, defineEventHandler } from "h3"
import type { AppSettingsDTO } from "@reprokit/shared"
import { db } from "../../db"
import { appSettings } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<AppSettingsDTO> => {
  await requireInstallAdmin(event)

  const [settings] = await db.select().from(appSettings).limit(1)
  if (!settings) {
    throw createError({ statusCode: 500, statusMessage: "App settings row missing" })
  }

  return {
    signupGated: settings.signupGated,
    allowedEmailDomains: settings.allowedEmailDomains,
    updatedAt: settings.updatedAt.toISOString(),
  }
})
