import { defineNitroPlugin } from "nitropack/runtime"
import { db } from "../db"
import { appSettings } from "../db/schema"

export default defineNitroPlugin(async () => {
  // Insert singleton row if missing. ON CONFLICT makes this idempotent.
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing({ target: appSettings.id })
  console.info("[seed-settings] app_settings singleton ensured")
})
