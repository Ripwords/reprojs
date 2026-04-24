// apps/dashboard/server/tasks/github/sync.ts
//
// Safety-net cron for the GitHub sync queue. The happy path now runs
// in-process (see `triggerReportSync()` fired from enqueue helpers), so
// this task's job is narrower: recover stuck-syncing rows after a
// crash, and retry any pending rows whose `next_attempt_at` has caught
// up with the retry backoff.
import { defineTask } from "nitropack/runtime"
import { drainPendingJobs, recoverStuckJobs } from "../../lib/github-sync-runner"

export default defineTask({
  meta: {
    name: "github:sync",
    description: "Drain report_sync_jobs — safety net for the in-process trigger",
  },
  async run() {
    await recoverStuckJobs()
    const { processed } = await drainPendingJobs()
    return { result: "ok", processed }
  },
})
