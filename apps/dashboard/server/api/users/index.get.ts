import { defineEventHandler } from "h3"
import { desc } from "drizzle-orm"
import type { UserDTO } from "@feedback-tool/shared"
import { db } from "../../db"
import { user } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<UserDTO[]> => {
  await requireInstallAdmin(event)

  const rows = await db.select().from(user).orderBy(desc(user.createdAt)).limit(500)

  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: (u.role ?? "member") as "admin" | "member",
    status: (u.status ?? "active") as "invited" | "active" | "disabled",
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  }))
})
