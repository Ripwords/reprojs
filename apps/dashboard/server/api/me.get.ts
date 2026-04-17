import { defineEventHandler } from "h3"
import { requireSession } from "../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    status: session.status,
    isAdmin: session.role === "admin",
  }
})
