import { eq, isNull } from "drizzle-orm"
import { defineNitroPlugin } from "nitropack/runtime"
import { db } from "../db"
import { projects } from "../db/schema"
import { generatePublicKey } from "../lib/project-key"

export default defineNitroPlugin(async () => {
  const missing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.publicKey))

  if (missing.length === 0) return

  await Promise.all(
    missing.map(({ id }) =>
      db.update(projects).set({ publicKey: generatePublicKey() }).where(eq(projects.id, id)),
    ),
  )
  console.info(`[backfill-public-keys] generated keys for ${missing.length} project(s)`)
})
