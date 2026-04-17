/**
 * Bun test preload file.
 * Checks that the Nuxt dev server is already running at TEST_BASE_URL.
 * Run tests with:   bun run test:e2e
 * which starts the dev server automatically.
 */
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

async function checkServer(retries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`, { signal: AbortSignal.timeout(3000) })
      if (res.status === 401 || res.status === 200) return
    } catch {
      // not ready yet
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(
    `Nuxt dev server not reachable at ${BASE_URL} after ${retries} retries. ` +
      `Start it with: bun run dev`,
  )
}

await checkServer()
