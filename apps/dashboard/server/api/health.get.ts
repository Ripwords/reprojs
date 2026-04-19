import { defineEventHandler, setResponseStatus } from "h3"
import { sql } from "drizzle-orm"
import { db } from "../db"

// Liveness + DB readiness probe for container healthchecks and load balancers.
// Keep it cheap: a single `SELECT 1` with the same statement_timeout as the
// rest of the pool (30s default). 200 = DB reachable; 503 otherwise.
export default defineEventHandler(async (event) => {
  try {
    await db.execute(sql`select 1`)
    return { status: "ok" }
  } catch (err) {
    setResponseStatus(event, 503)
    return {
      status: "unhealthy",
      reason: err instanceof Error ? err.message : "db ping failed",
    }
  }
})
