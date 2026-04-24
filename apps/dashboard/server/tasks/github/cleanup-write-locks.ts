// apps/dashboard/server/tasks/github/cleanup-write-locks.ts
// Nitro scheduled task — purges expired github_write_locks rows once a day.
// Write-locks have a 30s TTL and are consumed on first matching webhook, so
// this task is just an insurance sweep for any rows that were never consumed.
import { defineTask } from "nitropack/runtime"
import { db } from "../../db"
import { cleanupExpiredLocks } from "../../lib/github-write-locks"

export default defineTask({
  meta: {
    name: "github:cleanup-write-locks",
    description: "Delete expired github_write_locks rows (daily housekeeping)",
  },
  async run() {
    const deleted = await cleanupExpiredLocks(db)
    return { result: "ok", deleted }
  },
})
