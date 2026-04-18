import { createError, defineEventHandler, getRouterParam } from "h3"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { effectiveRole } = await requireProjectRole(event, id, "viewer")
  return { role: effectiveRole }
})
